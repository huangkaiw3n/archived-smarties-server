// Utility modules
const Promise = require('bluebird')
const moment = require('moment')
const JsonV = require('ajv')
const uuid = require('uuid/v4')
const _ = require('lodash')

// For logging
// const winston = require('winston')
// const logger = new (winston.Logger)({
//   transports: [
//     new (winston.transports.Console)({ json: true, stringify: true })
//   ]
// })

// Based on express, but for building for REST APIs
const restify = require('restify')

// JSON Web Token
const jwt = require('jsonwebtoken')
const JWT_SECRET = process.env.STREETSMART_JWT_SECRET || 'H76jfjut2g6y9cjWDsFMpbfNRzV3m2iWvUk'

// Stripe
const STRIPE_API_KEY = process.env.STREETSMART_STRIPE_API_KEY
const stripe = require('stripe')(STRIPE_API_KEY)

// DynamoDB
const AWS = require('aws-sdk')
const AWS_REGION = process.env.AWS_REGION
const docClient = new AWS.DynamoDB.DocumentClient({region: AWS_REGION})
Promise.promisifyAll(Object.getPrototypeOf(docClient))
// the document client doesn't have methods for table/database level operations
const dynamoDB = new AWS.DynamoDB({region: 'ap-southeast-1'})
Promise.promisifyAll(Object.getPrototypeOf(dynamoDB))

// Restify Configuration
const serverPort = process.env.PORT || 10000
const server = restify.createServer({
  name: 'street-smart'
})
// Restify middlewares
server.use(restify.CORS())
server.use(restify.queryParser())
server.use(restify.bodyParser())
server.use(restify.gzipResponse())

function getParkingSession (carparkCode, vehicleType, startTime, duration) {
  let endTime = moment.utc(startTime).add(duration, 'minutes')
  return {
    startTime: startTime.format(),
    endTime: endTime.format(),
    rates: [{
      rateId: 'abc123',
      version: 1,
      blockStartTime: startTime.format(),
      blockEndTime: endTime.format()
    }],
    cost: 100
  }
}

server.post('/v1/parkings', (req, res) => {
  // schema for the json body of a new parking request
  const newParkingSchema = {
    type: 'object',
    required: [
      'carparkCode',
      'vehicleType',
      'licensePlate',
      'duration',
      'expectedPrice',
      'stripeToken'
    ],
    properties: {
      carparkCode: {
        type: 'string'
      },
      lotNumber: {
        type: 'string'
      },
      vehicleType: {
        type: 'string',
        enum: ['car', 'motorcycle', 'heavy_vehicle']
      },
      licensePlate: {
        type: 'string',
        pattern: '^([a-zA-Z]{1,3})(\\d{1,5})([a-zA-Z]{1,2})$'
      },
      duration: {
        type: 'number',
        minimum: 1,
        maximum: 1440
      },
      expectedPrice: {
        type: 'number',
        minimum: 0.0
      },
      stripeToken: {
        type: 'string'
      }
    }
  }
  // need to test licensePlate pattern functionality

  // get new instance of validator
  const newParkingValidator = (new JsonV()).compile(newParkingSchema)

  // get body of POST request
  const payload = req.body

  // validate the payload
  const payloadIsValid = newParkingValidator(payload)

  // return error if invalid
  if (!payloadIsValid) {
    return res.json(401, { message: 'Malformed params provided.' })
  }

  // create logId from params
  // TODO: need to  modify this
  const logId = uuid()
  const commitments = []

  // setup a new parking session
  const startTime = moment.utc()
  let parkingSessionParams = getParkingSession(
    payload.carparkCode,
    payload.vehicleType,
    startTime,
    payload.duration
  )
  const parkingSessionId = uuid()

  // TODO: need to revisit this
  // prepare stripe charge
  const chargeParams = {
    source: payload.stripeTokenId,
    amount: parkingSessionParams.cost,
    currency: 'SGD',
    capture: false,
    description: parkingSessionId,
    metadata: { parkingSessionId: parkingSessionId },
    statement_descriptor: 'Street Smart Parking'
  }

  // make stripe charge
  let stripeCharge = stripe.charges.create(chargeParams)

  // catch stripe charge error
  stripeCharge.catch((error) => res.json(500, {
    message: 'error while making a stripe charge',
    error_from_stripe: error.raw
  }))

  // write parking session
  let parkingSession = stripeCharge.then((charge) => {
    // add charge to commitments
    commitments.append({
      type: 'stripeCharge',
      charge: charge
    })

    // prepare db write
    let putParams = {
      TableName: 'streetsmart-parking',
      Item: {
        id: parkingSessionId,
        version: 0,
        location: payload.carparkCode,
        session: {
          startTime: parkingSessionParams.startTime,
          endTime: parkingSessionParams.endTime,
          rates: parkingSessionParams.rates
        },
        commitments: commitments,
        cause: logId
      }
    }

    // write to db
    return docClient.putAsync(putParams)
  })

  // catch dynamodb error
  parkingSession.catch((error) => {
    // undo commitments
    // only handle stripe charge for now
    let undoStripeCharge = _.find(commitments, { type: stripeCharge })
    if (undoStripeCharge) {
      stripe
        .refunds
        .create({
          charge: undoStripeCharge.charge.id,
          amount: undoStripeCharge.charge.amount,
          metadata: undoStripeCharge.charge.metadata,
          reason: 'failed while creating parking session'
        })
        .then(() => res.json(500, {
          message: 'error while writing parking session to dynamodb',
          error_from_dynamo: error
        }))
        .catch((error) => res.json(500, {
          message: 'error while writing parking session to dynamodb. error while refunding a stripe charge',
          error_from_stripe: error.raw
        }))
    } else {
      return res.json(500, {
        message: 'error while writing parking session to dynamodb',
        error_from_dynamo: error
      })
    }
  })

  // do commits
  let commit = parkingSession.then(() => {
    // commit commitments
    // only handle stripe charge for now
    let captureStripeCharge = _.find(commitments, { type: stripeCharge })
    if (captureStripeCharge) {
      return stripe
        .charges
        .capture({
          charge: captureStripeCharge.charge.id,
          amount: captureStripeCharge.charge.amount
        })
        .then(() => jwt.sign(parkingSessionId, JWT_SECRET))
    } else {
      return jwt.sign(parkingSessionId, JWT_SECRET)
    }
  })

  commit
    .then((token) => res.json(200, token))
    .catch((error) => {
      // TODO: rollback parking session
      return res.json(500, {
        message: 'error while capturing a stripe charge',
        error_from_stripe: error.raw
      })
    })
})

server.get(/.*/, restify.serveStatic({
  directory: 'public',
  default: 'index.html'
}))

server.listen(serverPort, () => {
  console.log('%s listening at %s', server.name, server.url)
})
