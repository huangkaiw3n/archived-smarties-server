var _ = require('lodash');
var sk = process.env.STRIPE_SK;
var stripe = require("stripe")(sk);

// export function chargeCard (value, description, statement_descriptor, source, destination, idempotencyKey) {
exports.chargeCard = (options) => {

  // var amount = Math.round(options.value * 100);
  var amount = options.value;

  // var application_fee = calculateAdminFeeInCents(amount, isMicro(amount));

  var chargeDetails = _.defaults(_.omit(options,['value','idempotencyKey']), {
    amount,
    // application_fee,
    currency: "SGD",
    capture: true,
  })

  var chargePromise = options.idempotencyKey
    ? stripe.charges.create(chargeDetails, {idempotency_key: options.idempotencyKey})
    : stripe.charges.create(chargeDetails);

  console.log("request charge: ", chargeDetails)

  return chargePromise.then((charge) => {
    if (!charge.transfer) return charge;

    return stripe.transfers.retrieve(charge.transfer)
      .then((transfer) => {
        charge.transfer = transfer;
        return charge;
      }, () => {
        /* Ooops some problem retrieving the transfer, but not fatal, so let it continue */
        return charge;
      });
  });
};

exports.refundCharge = (chargeId, value, idempotencyKey) => {
  // Actual Refund is process here
  if (value) {
    return stripe.refunds.create({
      charge: chargeId, // charge ID to be indicated
      amount: value
      // refund_application_fee: false,
      // reverse_transfer: true
    }, {
      idempotency_key: idempotencyKey
    });
  }
  else {
    return stripe.refunds.create({
      charge: chargeId, // charge ID to be indicated
    }, {
      idempotency_key: idempotencyKey
    });
  }
};

exports.retrieveTransaction =  (transactionId) => {
  return stripe.balance.retrieveTransaction(transactionId);
};

exports.retrieveCharge = (chargeId) => {
  return stripe.charges.retrieve(chargeId);
};

exports.createStripeToken = (card) => {
  return stripe.tokens.create({card});
};

exports.saveCustomer = (stripeToken) => {
  var result = {
    code: 0,
    message: ""
  };
  stripe.customers.create({
    source: stripeToken,
    description: "Save Customer Info"
  }, function (err, customer) {
    if (err) {
      // The card has been declined
      console.log(err);
      result.code = -1;
      result.message = "There is some issue while trying to save the customer, please try again later! It the problem persist, please contact our staff.";
    } else {
      console.log("Success");
      console.log(customer);
      // get the id for the customer Id
      result.code = 1;
      result.message = "Customer Saved Successful";
    }
  });

  return result;
};

var isMicro =  (transactionSum) => {
  return transactionSum <= 1000;
};

var calculateAdminFeeInCents = (amount, micro) => {
  if (amount === 0) return 0;
  return (process.env.STRIPE_MICRO_RATES === 'true' && micro)
    ? (Math.round(amount * 0.05) + 10)
    : (Math.round(amount * 0.034) + 50);
};

exports.minTransactionCharge = () => {
  return (process.env.STRIPE_MICRO_RATES === 'true') ? 0.10 : 0.50;
};
