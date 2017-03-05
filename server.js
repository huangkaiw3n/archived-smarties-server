// Utility modules
const Promise = require('bluebird')
const moment = require('moment')
const JsonV = require('ajv')
const uuid = require('uuid/v4')
const _ = require('lodash')

// For logging
const winston = require('winston')
const logger = new (winston.Logger)({
  transports: [
    new (winston.transports.Console)({
      json: true,
      stringify: true,
      colorize: true
    })
  ]
})

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

class ServerError extends Error {
  constructor (code, message, errorObject) {
    super(message)
    this.code = code
    this.message = message
    this.errorObject = errorObject
    this.name = 'ServerError'
  }
}

class ClientError extends Error {
  constructor (code, message, errorObject) {
    super(message)
    this.code = code
    this.message = message
    this.errorObject = errorObject
    this.name = 'ServerError'
  }
}

class Log {
  constructor (height, width) {
    // get a unique log id
    this.id = uuid()
  }

  info (event, metadata) {
    logger.info(event, { logId: this.id, metadata: metadata })
    // logger.info(event)
  }

  error (event, metadata) {
    logger.error(event, { logId: this.id, metadata: metadata })
    // logger.error(event)
  }
}

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

server.post('/v1/parkings', async (req, res) => {
  const log = new Log()

  // get body of POST request
  const payload = req.body

  log.info('new parking session request', payload)

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

  // validate the payload
  const payloadIsValid = newParkingValidator(payload)

  // return error if invalid
  if (!payloadIsValid) {
    log.error('invalid params for new parking request', newParkingValidator.errors)
    throw new ServerError(401, 'Malformed params provided.', newParkingValidator.errors)
  }

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
    source: payload.stripeToken,
    amount: parkingSessionParams.cost,
    currency: 'SGD',
    capture: false,
    description: parkingSessionId,
    metadata: { parkingSessionId: parkingSessionId },
    statement_descriptor: 'Street Smart Parking'
  }

  try {
    log.info('creating new stripe charge', chargeParams)

    // make stripe charge
    try {
      var stripeCharge = await stripe.charges.create(chargeParams)
    } catch (error) {
      log.error('error while making a stripe charge', error.raw)
      throw new ServerError(500, 'error while making a stripe charge', error.raw)
    }

    // write parking session
    try {
      log.info('stripe charge created', stripeCharge)

      // add charge to commitments
      commitments.push({
        type: 'stripeCharge',
        charge: stripeCharge
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
          cause: log.id
        }
      }

      log.info('creating new parking session', putParams)

      // write to db
      var dynamoDbResponse = await docClient.putAsync(putParams)
    } catch (error) {
      log.error('error while writing parking session to dynamodb', error)

      // undo commitments
      // only handle stripe charge for now
      let undoStripeCharge = _.find(commitments, { type: 'stripeCharge' })
      if (undoStripeCharge) {
        var undoOptions = {
          charge: undoStripeCharge.charge.id,
          amount: undoStripeCharge.charge.amount,
          metadata: undoStripeCharge.charge.metadata
        }

        log.info('creating refund for stripe charge', undoOptions)

        try {
          let refund = await stripe.refunds.create(undoOptions)
          log.info('stripe charge refunded', refund)
        } catch (error) {
          log.error('error while refunding the stripe charge', error.raw)
          throw new ServerError(
            500,
            'error while writing parking session to dynamodb. error while refunding a stripe charge',
            error.raw
          )
        }
      }
      throw new ServerError(500, 'error while writing parking session to dynamodb', error)
    }

    log.info('new parking session created', dynamoDbResponse)

    // commit commitments
    // only handle stripe charge for now
    let captureStripeCharge = _.find(commitments, { type: 'stripeCharge' })

    if (captureStripeCharge) {
      log.info('capturing stripe charge', {
        id: captureStripeCharge.charge.id,
        amount: captureStripeCharge.charge.amount
      })

      try {
        let capture = await stripe.charges.capture(
          captureStripeCharge.charge.id,
          {
            amount: captureStripeCharge.charge.amount
          }
        )
        log.info('stripe charge captured', capture)
      } catch (error) {
        // TODO: rollback parking session
        log.error('error while capturing a stripe charge', error.raw)
        throw new ServerError(500, 'error while capturing a stripe charge', error.raw)
      }
    }
    let parkingSessionJwt = jwt.sign(parkingSessionId, JWT_SECRET)
    log.info('sending jwt for parking session to client', parkingSessionJwt)
    res.json(200, parkingSessionJwt)
    log.info('end', {})
  } catch (error) {
    if (error instanceof ClientError) {
      log.error('sending client error response', {
        message: error.message,
        code: error.code
      })
      res.json(error.code, { message: error.message })
      log.info('end', {})
    } else if (error instanceof ServerError) {
      log.error('sending server error response', {
        message: error.message,
        code: error.code
      })
      res.json(error.code, { message: error.message })
      log.info('end', {})
    } else {
      log.error('unknown server error', error)
      log.error('sending server error response', {
        message: 'Internal server error',
        code: 500
      })
      res.json(500, { message: 'Internal server error' })
      log.info('end', {})
    }
  }
})

server.post('/v1/parkings/:parkingId/extend', (req, res) => {
})

server.post('/v1/parkings/:parkingId/end', (req, res) => {
})

server.get(/.*/, restify.serveStatic({
  directory: 'public',
  default: 'index.html'
}))

server.listen(serverPort, () => {
  console.log('%s listening at %s', server.name, server.url)
})
