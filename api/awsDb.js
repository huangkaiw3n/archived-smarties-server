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
  console.log("Inserting into table", process.env.SMARTIES_PARKING_SESSIONS_TABLE)
  return docClient.putAsync({
    TableName : process.env.SMARTIES_PARKING_SESSIONS_TABLE,
    Item: parkingSession
  });
}

exports.getParkingSession = (hashKey, sortKey) => {
  return docClient.getAsync({
    TableName: process.env.SMARTIES_PARKING_SESSIONS_TABLE,
    Key: {
      date_carpark_code: hashKey,
      timestamp_parking_id: sortKey
    }
  });
}

exports.putTransaction = (transaction) => {
  return docClient.putAsync({
    TableName : process.env.SMARTIES_TRANSACTIONS_TABLE,
    Item: transaction
  });
}

exports.updateParkingSession = (hashKey, sortKey, parkingEvent, stripeChargeId) => {
  let parkingUpdate;

  if (stripeChargeId) {
    parkingUpdate = {
      "TableName": process.env.SMARTIES_PARKING_SESSIONS_TABLE,
      "Key": {
        "date_carpark_code": hashKey,
        "timestamp_parking_id": sortKey
      },
      "UpdateExpression": "set events=list_append(events,:p), stripe_charge_id=:s",
      "ExpressionAttributeValues": {
        ":p": [
          parkingEvent
        ],
        ":s": stripeChargeId
      }
    };
  } else {
    parkingUpdate = {
      "TableName": process.env.SMARTIES_PARKING_SESSIONS_TABLE,
      "Key": {
        "date_carpark_code": hashKey,
        "timestamp_parking_id": sortKey
      },
      "UpdateExpression": "set events=list_append(events,:p)",
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
