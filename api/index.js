var _ = require('lodash');
var restify = require('restify');
var fs = require('fs');
var ulid = require('ulid');
var moment = require('moment');
var utils = require('./utils');
var Promise = require("bluebird");
var AWS = require('aws-sdk');
var Firebase = require('./firebaseDatabase')
var Payment = require('./payments')

// JSON Validator
var jsonv = require('ajv');

// JSON Web Token
var jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.SMARTIES_JWT_SECRET || "abcdefg";

// Restify Configuration
var serverPort = process.env.PORT || 10000

var server = restify.createServer({
  name: 'smarties-api'
});

var smartiesUraCarparks = require("../resources/smartiesUraCarparks.json");
var smartiesUraCarparkRates = require("../resources/smartiesUraCarparkRates.json");

// add restify middleware
server.use(restify.CORS());
server.use(restify.queryParser());
server.use(restify.bodyParser());
server.use(restify.gzipResponse());

// DynamoDB Modules
var docClient = new AWS.DynamoDB.DocumentClient({region: 'ap-southeast-1'});
Promise.promisifyAll(Object.getPrototypeOf(docClient));
// the document client doesn't have methods for table/database level operations
var dynamoDB = new AWS.DynamoDB({region: 'ap-southeast-1'});
Promise.promisifyAll(Object.getPrototypeOf(dynamoDB));

// Set up validations
const postParkCarBodySchema = {
  type: 'object',
  required: [
    'carpark_code',
    'license_plate',
    'vehicle_type',
    'lot_number',
    'duration',
    'expectedPrice',
    'stripeTokenId'
  ],
  properties: {
    carpark_code: {
      type: 'string'
    },
    license_plate: {
      type: 'string',
      format: 'carplate'
    },
    vehicle_type: {
      type: 'string',
      enum: ['car', 'motorcycle', 'heavy_vehicle']
    },
    lot_number: {
      type: 'string'
    },
    duration: {
      type: 'number'
    },
    expectedPrice: {
      type: 'number'
    },
    stripeTokenId: {
      type: 'string'
    }
  }
};
// load schema into the validator
var validateParkCarBody = new jsonv();
validateParkCarBody.addFormat('carplate', /^(\D{1,3})(\d{1,5})(\D{1,2})$/);
const postParkCarValidator = validateParkCarBody.compile(postParkCarBodySchema);


// POST /v1/parkcar
// body: {
//   carpark_code: (string),
//   vehicle_type: (string), [car, motorcycle, heavy_vehicle],
//   lot_number: (string),
//   duration: (number) - in minutes,
//   expectedPrice: (number) - in cents,
//   stripeTokenId: (string)
// }
// Success response
// header: {
//   "smarties-jwt": jwt(parkingids)
// }
// body: {
//   carpark_code,
//   vehicle_type,
//   lot_number,
//   start_time,
//   end_time,
//   paid_amount
// }
// Failure response
// 401, { message: 'malformed request params provided!' }
// 409, { message: 'Price mismatch. Update prices or try again.'}

server.post('/v1/parkcar', async (req, res) => {
  let data = req.body;
  let token = req.headers['smarties-jwt'];
  console.log("token",token);
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
  var valid = postParkCarValidator(data);
  if (!valid) {
    return res.json(400, { message: 'Malformed params provided!' });
  }

  // Querying the carpark
  let carpark;
  console.log("Querying carpark_code", data.carpark_code);
  try {
    carpark = await getCarpark(data.carpark_code);
    carpark = carpark.Item;
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

  if (!jwtParkingSessions) {
    startTimestamp = Date.now();
  } else {
    startTimestamp = jwtParkingSessions[jwtParkingSessions.length - 1]['end_timestamp'];
  }

  let [startParkingMoment,
       endParkingMoment,
       chargedDuration,
       totalPrice] = utils.calculateParkingSession(
                       startTimestamp,
                       data.duration * 60000,
                       _.filter(smartiesUraCarparkRates, (r) => parkingType.rate_code.includes(r.rate_code)));

  // Means not allowed to park now
  if (chargedDuration === 0) {
    return res.json(409, {
      message: "No short term parking at this time."
    });
  }

  // Price algo mismatch or timing differences
  if (totalPrice !== data.expectedPrice) {
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

  //Time to insert parking session, then charge, then return succcess with info and jwt as payload
  // 1. Write pending_payment parkingSession into AWS
  // 2. Publish session on FB.
  // 3. Charge stripe
  // 4. Success Charge
  //      a. Insert transaction record into AWS
  //      b. Update parking session to completed_payment and set transactionId on AWS - We should continue if this fails
  //      c. Give success response to user
  // 4. Fail Charge (Yet to handle)
  //      a. Delete parking session on AWS
  //      b. Remove session on FB
  //      c. Give fail response to user
  let parkingSession = {
    date_carpark_code: `${moment().utcOffset(8).format('YYYY-MM-DD')}_${data.carpark_code}`,
    timestamp_parking_id: `${Date.now()}_${ulid()}`,
    license_plate: data.license_plate,
    vehicle_type: data.vehicle_type,
    lot_number: data.lot_number,
    start_timestamp: startParkingMoment.valueOf(),
    end_timestamp: endParkingMoment.valueOf(),
    transaction_id: null,
    parking_events: [{
      status: 'pending_payment',
      timestamp: Date.now()
    }]
  };

  try {
    // Insert into parking session table
    let insertedParking = await putParkingSession(parkingSession);

    console.log("insertedParking obj: ", insertedParking);

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

    // Charge via stripe
    let chargeOptions = {
      value: totalPrice,
      description: `CP-${data.carpark_code} LP-${data.license_plate}`,
      statement_descriptor: `CP-${data.carpark_code} LP-${data.license_plate}`,
      idempotencyKey: `charge_${parkingSession.timestamp_parking_id}`,
    };

    if (data.stripeTokenId.split("_")[0] === "cus"){
      chargeOptions = _.assign(chargeOptions, {customer: data.stripeTokenId})
    } else {
      chargeOptions = _.assign(chargeOptions, {source: data.stripeTokenId})
    }

    let stripeCharge = await Payment.chargeCard(chargeOptions);

    let completedChargeTimestamp = Date.now();

    let transaction = {
      transaction_id: ulid(),
      parking_id: {
        date_carpark_code: parkingSession.date_carpark_code,
        timestamp_parking_id: parkingSession.timestamp_parking_id
      },
      stripe_charge_id: stripeCharge.id,
      events: [{
        type: "payment",
        amount: totalPrice,
        timestamp: completedChargeTimestamp
      }],
      metadata: `CP-${data.carpark_code} LP-${data.license_plate} `
    };

    let insertedTransaction = await putTransaction(transaction);

    await updateParkingSession(parkingSession.date_carpark_code,
                               parkingSession.timestamp_parking_id,
                               {"status": "completed_payment","timestamp": completedChargeTimestamp},
                               transaction.transaction_id);

    parkingSession = _.assign(parkingSession,
      {
        parking_events: parkingSession['parking_events'].concat([{"status": "completed_payment","timestamp": completedChargeTimestamp}])
      },
      {transaction_id: transaction.transaction_id}
    );

  } catch (err) {
    console.log(err);
    console.log(parkingSession);
    return res.json(409, {message: err});
  }

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

  let carparkCode = jwtParkingSessions[0]['date_carpark_code'].split("_")[1];
  let carpark = _.find(smartiesUraCarparks, (cp) => cp.carpark_code === carparkCode);
  let parkingType = _.find(carpark["parking_types"], (pt) => pt.vehicle_type === jwtParkingSessions[0]['vehicle_type']);
  let rateCodesApplied = _.filter(smartiesUraCarparkRates, (r) => parkingType.rate_code.includes(r.rate_code))

  let now = Date.now();
  let sessionToPartialRefund = _.find(jwtParkingSessions, (p) => p.start_timestamp <= now && p.end_timestamp > now);
  let sessionsToFullRefund = _.filter(jwtParkingSessions, (p) => now <= p.start_timestamp);

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
    transactionToPartialRefund = await getTransaction(sessionToPartialRefund.transaction_id)
    transactionToPartialRefund = transactionToPartialRefund.Item;

    paymentToPartialRefund = _.find(transactionToPartialRefund.events, (e) => e.type === "payment");

    console.log("Payment to refund", paymentToPartialRefund)
    console.log("sessionToPartialRefund", sessionToPartialRefund)
    console.log("rateCodesApplied", rateCodesApplied)

    let partialRefundAmount = paymentToPartialRefund.amount -
                              utils.calculateParkingSession(
                                sessionToPartialRefund.start_timestamp,
                                now - sessionToPartialRefund.start_timestamp,
                                rateCodesApplied
                              )[3];

                              console.log("Partial Refund amount:", partialRefundAmount)


    let chargePartialRefunded =  await Payment.refundCharge(
                                   transactionToPartialRefund.stripe_charge_id,
                                   partialRefundAmount,
                                   `refund_${sessionToPartialRefund.timestamp_parking_id}`);

    totalRefundedAmount = totalRefundedAmount + chargePartialRefunded.amount;

    await updateParkingSession(
      sessionToPartialRefund.date_carpark_code,
      sessionToPartialRefund.timestamp_parking_id,
      {"status": "completed_refund","timestamp": now}
    );

    await updateTransaction(
      sessionToPartialRefund.transaction_id,
      {"type": "refund", "timestamp": now, "amount": chargePartialRefunded.amount}
    );

    for (p in sessionsToFullRefund ) {
      let transactionToFullRefund = await getTransaction(sessionsToFullRefund[p].transaction_id);
      transactionToFullRefund = transactionToFullRefund.Item;
      let chargeFullRefunded = await Payment.refundCharge(
                                     transactionToFullRefund.stripe_charge_id,
                                     0,
                                     `refund_${sessionsToFullRefund[p].timestamp_parking_id}`);
      totalRefundedAmount = totalRefundedAmount + chargeFullRefunded.amount;

      console.log("Total Refunded inside:", totalRefundedAmount);
      await updateParkingSession(
        sessionsToFullRefund[p].date_carpark_code,
        sessionsToFullRefund[p].timestamp_parking_id,
        {"status": "completed_refund","timestamp": now}
      );
      await updateTransaction(
        sessionsToFullRefund[p].transaction_id,
        {"type": "refund", "timestamp": now, "amount": chargeFullRefunded.amount}
      );
    };
  }
  catch (err) {
    return res.json(400, {
      error: err
    });
  }

  // Remove published session on FB
  await Firebase.getDatabase().ref(`/${carparkCode}/${jwtParkingSessions[0]['timestamp_parking_id']}`).remove();

  res.json({
    body: {
      amountRefunded: totalRefundedAmount
    }
  });

});

function getTransaction(transactionId) {
  return docClient.getAsync({
    Key: {
      "transaction_id": transactionId
    },
    TableName: 'smarties-transactions'
  });
}

function getCarpark(carparkCode) {
  return docClient.getAsync({
    Key: {
      "carpark_code": carparkCode
    },
    TableName: 'smarties-ura-carparks'
  });
}

function putParkingSession(parkingSession) {
  return docClient.putAsync({
    TableName : "smarties-parking-sessions",
    Item: parkingSession
  });
}

function putTransaction(transaction) {
  return docClient.putAsync({
    TableName : "smarties-transactions",
    Item: transaction
  });
}

function updateParkingSession(hashKey, sortKey, parkingEvent, transactionId) {
  let parkingUpdate;

  if (transactionId) {
    parkingUpdate = {
      "TableName": "smarties-parking-sessions",
      "Key": {
        "date_carpark_code": hashKey,
        "timestamp_parking_id": sortKey
      },
      "UpdateExpression": "set parking_events=list_append(parking_events,:p), transaction_id=:t",
      "ExpressionAttributeValues": {
        ":p": [
          parkingEvent
        ],
        ":t": transactionId
      }
    };
  } else {
    parkingUpdate = {
      "TableName": "smarties-parking-sessions",
      "Key": {
        "date_carpark_code": hashKey,
        "timestamp_parking_id": sortKey
      },
      "UpdateExpression": "set parking_events=list_append(parking_events,:p)",
      "ExpressionAttributeValues": {
        ":p": [
          parkingEvent
        ]
      }
    };
  }

  return docClient.updateAsync(parkingUpdate);
}

function updateTransaction(hashKey, transactionEvent) {
  let transactionUpdate = {
    "TableName": "smarties-transactions",
    "Key": {
      "transaction_id": hashKey,
    },
    "UpdateExpression": "set events=list_append(events,:p)",
    "ExpressionAttributeValues": {
      ":p": [
        transactionEvent
      ]
    }
  };

  return docClient.updateAsync(transactionUpdate);
}

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
