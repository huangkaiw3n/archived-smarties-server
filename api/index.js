var restify = require('restify');
var ulid = require('ulid');
var moment = require('moment');
var utils = require('./utils');
var Firebase = require('./firebaseDatabase');
var awsDb = require('./awsDb');
var Payment = require('./payments');

var validator = require('./validator')

var chalk = require('chalk');
var _ = require('lodash');

var smartiesUraCarparks = require("../resources/smartiesUraCarparks.json");
var smartiesUraCarparkRates = require("../resources/smartiesUraCarparkRates.json");

// JSON Web Token
var jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.SMARTIES_JWT_SECRET || "abcdefg";

const nowFormatted = () => moment().utcOffset(8).format();

// Restify Configuration
var serverPort = process.env.PORT || 10000

var server = restify.createServer({
  name: 'smarties-api'
});

// add restify middleware
server.use(restify.CORS());
server.use(restify.queryParser());
server.use(restify.bodyParser());
server.use(restify.gzipResponse());

server.post('/v1/parkcar', async (req, res) => {
  let data = req.body;
  let token = req.headers['smarties-jwt'];
  console.log("Smarties-jwt token:", token ? true : false);
  let decodedToken;
  let jwtParkingSessions; // previous sessions from jwt

  try {
    if (token) {
      decodedToken = jwt.verify(token, JWT_SECRET);
      jwtParkingSessions = decodedToken.parkingSessions;
    }
  } catch (err) {
    return res.json(400, { message: 'Invalid jwt provided'});
  }

  // validate the json body data
  var valid = validator.postParkCarValidator(data);
  if (!valid) {
    return res.json(400, { message: 'Malformed params provided!' });
  }

  // Querying the carpark
  let carpark;
  console.log("Querying carpark_code", data.carpark_code);
  // try {
  //   carpark = await getCarpark(data.carpark_code);
  //   carpark = carpark.Item;
  // } catch (err) {
  //   return res.json(400, {
  //     error: err
  //   });
  // }

  try {
    carpark = _.find(smartiesUraCarparks, (c) => c.carpark_code === data.carpark_code);
  } catch (err) {
    return res.json(400, {
      error: err
    });
  }

  if (!carpark) {
    return res.json(409, {
      message: `Carpark ${data.carpark_code} not found`
    });
  }

  // Checking if there is parking type available for given vehicle type
  let parkingType = _.find(carpark.parking_types,
    (pt) => pt.vehicle_type === data.vehicle_type);

  if (!parkingType) {
      return res.json(409, {
        message: `${data.vehicle_type} not allowed in this carpark`
    });
  }

  // Checking if rates present for given parking type
  if (parkingType.rate_code.length === 0) {
      return res.json(409, {
        message: `No rates for ${data.vehicle_type} found in this carpark`
    });
  }

  // Calculate the parking session based on a specified start time.
  // Take the start parking time to be Date.now() if no jwt provided.
  // Else, take the start parking time to be the end time of the last parking session in the jwt
  let startTimestamp;
  let endTimestamp;
  let parkingDuration;
  let paidAmount = null;

  if (!jwtParkingSessions) {
    startTimestamp = moment();
    parkingDuration = data.duration * 60000;
  } else {
    console.log("Extension");
    startTimestamp = moment(jwtParkingSessions[0]['start_timestamp']);
    endTimestamp = moment(jwtParkingSessions[jwtParkingSessions.length - 1]['end_timestamp']);
    let paidDuration = endTimestamp - startTimestamp;
    parkingDuration = paidDuration + (data.duration * 60000);

    paidAmount = utils.calculateParkingSession(
                   startTimestamp,
                   paidDuration,
                   _.filter(smartiesUraCarparkRates, (r) => parkingType.rate_code.includes(r.rate_code)),
                   _.get(carpark, 'day_cap', null)
                 )[3];
    console.log(`Amount Already Paid: ${paidAmount}`);
  }

  // let [startParkingMoment,
  //      endParkingMoment,
  //      chargedDuration,
  //      totalPrice] = utils.calculateParkingSession(
  //                      startTimestamp,
  //                      data.duration * 60000,
  //                      _.filter(smartiesUraCarparkRates, (r) => parkingType.rate_code.includes(r.rate_code)),
  //                      _.get(carpark, 'day_cap', null)
  //                    );

  let [startParkingMoment,
       endParkingMoment,
       chargedDuration,
       totalPrice] = utils.calculateParkingSession(
                       startTimestamp,
                       parkingDuration,
                       _.filter(smartiesUraCarparkRates, (r) => parkingType.rate_code.includes(r.rate_code)),
                       _.get(carpark, 'day_cap', null)
                     );

  if (paidAmount) {
    totalPrice = totalPrice - paidAmount;
  }

  console.log(`totalPrice: ${totalPrice}, paidAmount: ${paidAmount}`);

  // Means not allowed to park now
  if (chargedDuration === 0) {
    return res.json(409, {
      message: "No short term parking at this time."
    });
  }

  // Price algo mismatch or timing differences
  let priceDiff = Math.abs(totalPrice - data.expectedPrice);

  if (priceDiff > 10) { //Allow price diff of 10 cents
    return res.json(409, {
      message: `Price calculation mismatch, Client Expected Price: ${data.expectedPrice}. Server Expected Price: ${totalPrice}`
    });
  }

  // Means currently free parking
  if (totalPrice === 0) {
    return res.json(409, {
      message: "Free parking available"
    });
  }

  let sessionCreatedTimestamp = nowFormatted();

  let parkingDate = moment().utcOffset(8).format('YYYY-MM-DD');

  let parkingSession = {
    date_carpark_code: `${parkingDate}_${data.carpark_code}`,
    date: parkingDate,
    carpark_code: data.carpark_code,
    timestamp_parking_id: `${sessionCreatedTimestamp}_${ulid()}`,
    license_plate: data.license_plate,
    vehicle_type: data.vehicle_type,
    lot_number: data.lot_number,
    start_timestamp: jwtParkingSessions ? endTimestamp.utcOffset(8).format() : startParkingMoment.utcOffset(8).format(),
    end_timestamp: endParkingMoment.utcOffset(8).format(),
    events: [{
      status: 'pending_payment',
      timestamp: sessionCreatedTimestamp
    }]
  };

  console.log(`Parking to ${data.carpark_code}, LP: ${data.license_plate} VT: ${data.vehicle_type} LOT: ${data.lot_number}`)

  try {
    // Insert into parking session table
    let insertedParking = await awsDb.putParkingSession(parkingSession);

    console.log("Inserted Parking Session");

    // Publish on Firebase
    if (!jwtParkingSessions){
      await Firebase.getDatabase().ref(`/${data.carpark_code}/${parkingSession.timestamp_parking_id}`).set({
        license_plate: parkingSession.license_plate,
        vehicle_type: parkingSession.vehicle_type,
        startTimestamp: parkingSession.start_timestamp,
        validTill: parkingSession.end_timestamp,
        lotNo: parkingSession.lot_number
      });
    } else { // Just update the end time of an extended parking session
      await Firebase.getDatabase().ref(`/${data.carpark_code}/${jwtParkingSessions[0]['timestamp_parking_id']}`).update({
        validTill: parkingSession.end_timestamp,
      });
    }
    console.log("Published on Firebase");
  } catch (err) {
    console.log("Error: Could not set up parking session", err);
    return res.json(409, {error: err});
  }

  // Charge via stripe
  let chargeOptions = {
    value: totalPrice,
    description: `TxnId: ${parkingSession.timestamp_parking_id} Carpark:${data.carpark_code}`,
    statement_descriptor: `CP-${data.carpark_code} LP-${data.license_plate}`,
    idempotencyKey: `charge_${parkingSession.timestamp_parking_id}`,
  };

  if (data.stripeTokenId.split("_")[0] === "cus"){
    chargeOptions = _.assign(chargeOptions, {customer: data.stripeTokenId})
  } else {
    chargeOptions = _.assign(chargeOptions, {source: data.stripeTokenId})
  }

  let stripeCharge;
  let completedChargeTimestamp;

  try {
    stripeCharge = await Payment.chargeCard(chargeOptions);
    completedChargeTimestamp = nowFormatted();
    console.log(`Charged ${totalPrice} via Stripe`);
  } catch (err) {
    // Rollback and return fail
    console.log("Rolling back");

    let failedChargeId = _.get(err, 'raw.charge', null);
    let failureTimestamp = nowFormatted();
    await awsDb.updateParkingSession(
      parkingSession.date_carpark_code,
      parkingSession.timestamp_parking_id,
      {"status": "charge_failed","timestamp": failureTimestamp},
      failedChargeId
    );
    console.log("Updated parking session to failed")
    if (!jwtParkingSessions){
      await Firebase.getDatabase().ref(`/${data.carpark_code}/${parkingSession.timestamp_parking_id}`).remove();
    } else {
      await Firebase.getDatabase().ref(`/${data.carpark_code}/${jwtParkingSessions[0]['timestamp_parking_id']}`).update({
        validTill: jwtParkingSessions[jwtParkingSessions.length - 1]['end_timestamp']
      });
    }
    console.log("Removed/updated firebase entry");
    console.log("Error: Charge Failed", err);
    return res.json(409, {error: err});
  }

  try {
    await awsDb.updateParkingSession(
      parkingSession.date_carpark_code,
      parkingSession.timestamp_parking_id,
      {
        "status": "completed_payment",
        "amount": totalPrice,
        "timestamp": completedChargeTimestamp
      },
      stripeCharge.id
    );
    console.log("Updated Parking Session");
  } catch (err) {
    console.log("Error: Could not update transaction/parking session after charging", err)
  }

  parkingSession = _.assign(parkingSession,
    {
      events: parkingSession['events'].concat(
        [{
          "status": "completed_payment",
          "amount": totalPrice,
          "timestamp": completedChargeTimestamp}
        ]
      )
    },
    {stripe_charge_id: stripeCharge.id}
  );

  let jwtPayload;
  let signedJwt;

  if (!jwtParkingSessions) {
    jwtPayload = [parkingSession];
  } else {
    jwtParkingSessions.push(parkingSession);
    jwtPayload = jwtParkingSessions;
  }

  signedJwt = jwt.sign({parkingSessions: jwtPayload}, JWT_SECRET);

  res.header('smarties-jwt', signedJwt);
  res.json({
    body: {
      carpark_code: data.carpark_code,
      chargedDuration,
      totalPrice,
      parkingSession
    }
  });
});

// For each returned parking session in jwt, check
server.post('/v1/stopparking', async (req, res) => {
  let token = req.headers['smarties-jwt'];
  let decodedToken;
  let jwtParkingSessions; // previous sessions from jwt

  try {
    if (token) {
      decodedToken = jwt.verify(token, JWT_SECRET);
      jwtParkingSessions = decodedToken.parkingSessions;
    }
  } catch (err) {
    return res.json(401, { message: 'Invalid jwt provided'});
  }

  console.log(`Sessions: ${JSON.stringify(jwtParkingSessions, undefined, 2)}`)

  let carparkCode = jwtParkingSessions[0]['carpark_code'];
  let carpark = _.find(smartiesUraCarparks, (cp) => cp.carpark_code === carparkCode);
  let parkingType = _.find(carpark["parking_types"], (pt) => pt.vehicle_type === jwtParkingSessions[0]['vehicle_type']);
  let rateCodesApplied = _.filter(smartiesUraCarparkRates, (r) => parkingType.rate_code.includes(r.rate_code))

  let now = moment();
  let sessionToPartialRefund = _.find(jwtParkingSessions, (session) => moment(session.start_timestamp) <= now && moment(session.end_timestamp) > now);
  let sessionsToFullRefund = _.filter(jwtParkingSessions, (session) => now <= moment(session.start_timestamp));

  if (!sessionToPartialRefund) {
    return res.json(409, {
      message: "No eligible refunds"
    });
  }

  // Doing partial refund first
  let totalRefundedAmount = 0;
  let transactionToPartialRefund;
  let paymentToPartialRefund;

  try {
    paymentToPartialRefund = _.find(sessionToPartialRefund.events, (event) => event.status === "completed_payment");

    console.log("Payment to refund", paymentToPartialRefund)

    let partialRefundAmount = paymentToPartialRefund.amount -
                              utils.calculateParkingSession(
                                sessionToPartialRefund.start_timestamp,
                                now - moment(sessionToPartialRefund.start_timestamp),
                                rateCodesApplied
                              )[3];

    console.log("Partial Refund amount:", partialRefundAmount)

    if (partialRefundAmount) {
      let chargePartialRefunded = await Payment.refundCharge(
                                    sessionToPartialRefund.stripe_charge_id,
                                    partialRefundAmount,
                                    `refund_${sessionToPartialRefund.timestamp_parking_id}`);

      totalRefundedAmount = totalRefundedAmount + chargePartialRefunded.amount;

      await awsDb.updateParkingSession(
        sessionToPartialRefund.date_carpark_code,
        sessionToPartialRefund.timestamp_parking_id,
        {
          "status": "completed_refund",
          "timestamp": now.utcOffset(8).format(),
          "amount": chargePartialRefunded.amount
        }
      );
    }

    for (p in sessionsToFullRefund ) {
      let chargeFullRefunded = await Payment.refundCharge(
                                     sessionsToFullRefund[p].stripe_charge_id,
                                     0,
                                     `refund_${sessionsToFullRefund[p].timestamp_parking_id}`);
      totalRefundedAmount = totalRefundedAmount + chargeFullRefunded.amount;

      console.log("Total Refunded inside:", totalRefundedAmount);
      await awsDb.updateParkingSession(
        sessionsToFullRefund[p].date_carpark_code,
        sessionsToFullRefund[p].timestamp_parking_id,
        {
          "status": "completed_refund",
          "timestamp": now.utcOffset(8).format(),
          "amount": chargeFullRefunded.amount
        }
      );
    }
  }
  catch (err) {
    return res.json(400, {
      error: err
    });
  }

  // Remove published session on FB
  try {
    await Firebase.getDatabase().ref(`/${carparkCode}/${jwtParkingSessions[0]['timestamp_parking_id']}`).remove();
  } catch (err) {
    // Notify soft fail.
    console.log("Error: Failed to remove parking session after refund", err)
  }

  res.json({
    body: {
      amountRefunded: totalRefundedAmount
    }
  });

});

Firebase.getDatabase();

var connectedRef = Firebase.getDatabase().ref(".info/connected");
connectedRef.on("value", (snap) => {
  if (snap.val()) {
    console.log("Firebase Connected");
  } else {
    console.log("Firebase Disconnected");
  }
});

server.listen(serverPort, () => {
  console.log('%s listening at %s', server.name, server.url);
});

console.log(chalk.blue(`ENVIRONMENT LOADED ${process.env.ENVIRONMENT_NAME}`));
