// Returns a standard Node.js HTTP server
// var dynalite = require('dynalite'),
//     dynaliteServer = dynalite({path: './mydb'})
//
// // Listen on port 4567
// dynaliteServer.listen(4567, function(err) {
//   if (err) throw err
//   console.log('Dynalite started on port 4567')
// })

// AWS Modules
var _ = require('lodash');
var fs = require('fs');
var ulid = require('ulid');
var moment = require('moment');
var utils = require('../api/utils');
var Promise = require("bluebird");
var AWS = require('aws-sdk');

// DynamoDB Modules
var docClient = new AWS.DynamoDB.DocumentClient({region: 'us-west-2'});
Promise.promisifyAll(Object.getPrototypeOf(docClient));
// the document client doesn't have methods for table/database level operations
var dynamoDB = new AWS.DynamoDB({region: 'us-west-2'});
Promise.promisifyAll(Object.getPrototypeOf(dynamoDB));

// var uraRates = require('../resources/ura_parking_codes_rates.json');
//
// var uraRatesDb = require('../resources/smartiesUraCarparkRates.json');
//
// let counter = 0;

// _.forEach(uraRatesDb, async (rateItem) => {
//   let params = {
//     TableName : 'smarties-ura-carpark-rates',
//     Item: rateItem
//   };
//   try {
//     console.log(`inserting ${++counter}`)
//     await docClient.putAsync(params)
//   } catch (err) {
//     console.log(err);
//     console.log(rateItem);
//   }
// });


// Creating Table

var params = {
  TableName: "smarties-parking-sessions",
  KeySchema: [
    {
      AttributeName: "date_carpark_code",
      KeyType: "HASH"
    },
    {
      AttributeName: "timestamp_parking_id",
      KeyType: "RANGE"
    }
  ],
  AttributeDefinitions: [
    {
      AttributeName: "date_carpark_code",
      AttributeType: "S"
    },
    {
      AttributeName: "timestamp_parking_id",
      AttributeType: "S"
    }
  ],
  ProvisionedThroughput: {
    ReadCapacityUnits: 3,
    WriteCapacityUnits: 1
  }
};

// AWS.config.update({
//   region: "us-west-2",
// });

var dynamodb = new AWS.DynamoDB({
  region: "us-west-2"
});

dynamodb.createTable(params, function(err, data) {
  if (err) console.log(err, err.stack); // an error occurred
  else     console.log(data);           // successful response
});

// ## carpark_rates
//
// ### columns
//
// 1.  rate_code (string) (primary key) (ULID)
// 2.  timestamp (secondary sort key)
// 3.  ref_rate_code (string)
// 4.  start_time [HH:MM]
// 5.  end_time [HH:MM]
// 6.  start_day_of_week [1,2,3,4,5,6,7] (ISO Mon - 1, Tue - 2, ...)
// 7.  end_day_of_week [1,2,3,4,5,6,7] (ISO Mon - 1, Tue - 2, ...)
// 8.  parking_time_type (enum) [day, evening, whole_day, overnight, anything]
// 9.  parking_block_duration [minutes]
// 10. parking_rate [num] (dollars)

const timeType = (timeClass) => {
  switch (timeClass){
    case 'D':
      return "day";
    case 'E':
      return "evening";
    case 'W':
      return "whole_day";
    case "O":
      return "overnight";
    default:
      return timeClass;
  }
}

// let { id, structure_code,
//   effective_date, time_class,
//   start_time, end_time,
//   weekday_block, weekday_rate,
//   sat_block, sat_rate,
//   sun_block, sun_rate,
//   user_id, record_sequence } = uraRates[0];

// var params = {
//   TableName : 'smarties-ura-carpark-rates',
//   Item: weekdayItem
// };
//
// docClient.putAsync(params)
// .then((data) => console.log(data))
// .catch((err) => console.log(err))

// let smartiesUraCarparkRates = [];
//
// _.forEach(uraRates, async (rateItem) => {
//   let { id, structure_code,
//     effective_date, time_class,
//     start_time, end_time,
//     weekday_block, weekday_rate,
//     sat_block, sat_rate,
//     sun_block, sun_rate,
//     user_id, record_sequence } = rateItem;
//
//     let weekdayItem = {
//       rate_code: ulid(),
//       timestamp: Date.now().toString(),
//       ref_rate_code: structure_code,
//       start_time: moment(start_time, "h:mm").format("HH:mm"),
//       end_time: moment(end_time, "h:mm").format("HH:mm"),
//       start_day_of_week: 1,
//       end_day_of_week: 5,
//       parking_time_type: timeType(time_class),
//       parking_block_duration: weekday_block,
//       parking_rate: weekday_rate
//     };
//
//     let satItem = {
//       rate_code: ulid(),
//       timestamp: Date.now().toString(),
//       ref_rate_code: structure_code,
//       start_time: moment(start_time, "h:mm").format("HH:mm"),
//       end_time: moment(end_time, "h:mm").format("HH:mm"),
//       start_day_of_week: 6,
//       end_day_of_week: 6,
//       parking_time_type: timeType(time_class),
//       parking_block_duration: sat_block,
//       parking_rate: sat_rate
//     };
//
//     let sunItem = {
//       rate_code: ulid(),
//       timestamp: Date.now().toString(),
//       ref_rate_code: structure_code,
//       start_time: moment(start_time, "h:mm").format("HH:mm"),
//       end_time: moment(end_time, "h:mm").format("HH:mm"),
//       start_day_of_week: 7,
//       end_day_of_week: 7,
//       parking_time_type: timeType(time_class),
//       parking_block_duration: sun_block,
//       parking_rate: sun_rate
//     };
//
//     smartiesUraCarparkRates.push(weekdayItem);
//     smartiesUraCarparkRates.push(satItem);
//     smartiesUraCarparkRates.push(sunItem);
// });
//
// utils.writeToFile("smartiesUraCarparkRates.json", JSON.stringify(smartiesUraCarparkRates, null, 2));
