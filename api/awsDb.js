var Promise = require("bluebird");
var AWS = require('aws-sdk');

// DynamoDB Modules
var docClient = new AWS.DynamoDB.DocumentClient({region: 'us-west-2'});
Promise.promisifyAll(Object.getPrototypeOf(docClient));
// the document client doesn't have methods for table/database level operations
var dynamoDB = new AWS.DynamoDB({region: 'us-west-2'});
Promise.promisifyAll(Object.getPrototypeOf(dynamoDB));

exports.getTransaction = (transactionId) => {
  return docClient.getAsync({
    Key: {
      "transaction_id": transactionId
    },
    TableName: process.env.SMARTIES_TRANSACTIONS_TABLE
  });
}

exports.getCarpark = (carparkCode) => {
  return docClient.getAsync({
    Key: {
      "carpark_code": carparkCode
    },
    TableName: 'smarties-ura-carparks'
  });
}

exports.putParkingSession = (parkingSession) => {
  return docClient.putAsync({
    TableName : process.env.SMARTIES_PARKING_SESSIONS_TABLE,
    Item: parkingSession
  });
}

exports.putTransaction = (transaction) => {
  return docClient.putAsync({
    TableName : process.env.SMARTIES_TRANSACTIONS_TABLE,
    Item: transaction
  });
}

exports.updateParkingSession = (hashKey, sortKey, parkingEvent, transactionId) => {
  let parkingUpdate;

  if (transactionId) {
    parkingUpdate = {
      "TableName": process.env.SMARTIES_PARKING_SESSIONS_TABLE,
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
      "TableName": process.env.SMARTIES_PARKING_SESSIONS_TABLE,
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

exports.updateTransaction = (hashKey, transactionEvent, stripeChargeId) => {
  let transactionUpdate;

  if (stripeChargeId){
    transactionUpdate =  {
      "TableName": process.env.SMARTIES_TRANSACTIONS_TABLE,
      "Key": {
        "transaction_id": hashKey,
      },
      "UpdateExpression": "set events=list_append(events,:p), stripe_charge_id=:s",
      "ExpressionAttributeValues": {
        ":p": [
          transactionEvent
        ],
        ":s": stripeChargeId
      }
    };
  } else {
    transactionUpdate =  {
      "TableName": process.env.SMARTIES_TRANSACTIONS_TABLE,
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
  }
  return docClient.updateAsync(transactionUpdate);
}
