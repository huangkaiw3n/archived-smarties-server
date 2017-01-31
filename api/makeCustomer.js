var _ = require('lodash');
var restify = require('restify');
var fs = require('fs');
var ulid = require('ulid');
var moment = require('moment');
var utils = require('./utils');
var Promise = require("bluebird");
var Payment = require('./payments')

Payment.createStripeToken({
  number: "4242424242424242",
  exp_month: "12",
  exp_year: "2017",
  cvc: "123"
}).then((token) => Payment.saveCustomer(token.id))
.catch((err) => console.log(err))
