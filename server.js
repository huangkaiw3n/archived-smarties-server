// Utility modules
const Promise = require('bluebird')
const moment = require('moment')
const JsonV = require('ajv')

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
// const jwt = require('jsonwebtoken')
// const JWT_SECRET = process.env.STREETSMART_JWT_SECRET || 'H76jfjut2g6y9cjWDsFMpbfNRzV3m2iWvUk'

// Stripe
// const STRIPE_API_KEY = process.env.STREETSMART_STRIPE_API_KEY
// const stripe = require('stripe')(STRIPE_API_KEY)

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
    rateBlocks: [{
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
      'stripeTokenId'
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
      stripeTokenId: {
        type: 'string'
      }
    }
  }
  // need to test licensePlate pattern functionality

  // get new instance of validator
  const newParkingValidator = new JsonV()
  newParkingValidator.compile(newParkingSchema)

  // get body of POST request
  const payload = req.body

  // validate the payload
  const payloadIsValid = newParkingValidator(payload)

  // return error if invalid
  if (!payloadIsValid) {
    return res.json(401, { message: 'Malformed params provided.' })
  }

  // setup a new parking session
  const startTime = moment.utc()

  let parkingSession = getParkingSession(
    payload.carparkCode,
    payload.vehicleType,
    startTime,
    payload.duration
  )

  // prepare a charge (commitment)
  // write to dynamo
  // fulfil commitments
  // return signed token for parking
})

server.listen(serverPort, () => {
  console.log('%s listening at %s', server.name, server.url)
})
