// Utility modules
const Promise = require('bluebird')
const moment = require('moment')
const jsonv = require('ajv')

// For logging
const winston = require('winston')
const logger = new (winston.Logger)({
  transports: [
    new (winston.transports.Console)({ json: true, stringify: true })
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

server.listen(serverPort, () => {
  console.log('%s listening at %s', server.name, server.url)
})
