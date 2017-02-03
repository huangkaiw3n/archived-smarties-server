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
_ = require('lodash');
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

// var uraCarparks = require('../resources/ura_ppcode_ratescode.json');
// var carparks = require('../resources/carparksEdited.json');
// var smartiesUraCarparkRates = require('../resources/smartiesUraCarparkRates.json');
// var uraGroupedCarparks = require('../resources/uraGroupedCarparks.json');
var smartiesUraCarparksDump = require('../resources/smartiesUraCarparks.json');

// function fetchRateCodes(ref_rate_code) {
//   let rateCodes = [];
//   _.forEach(smartiesUraCarparkRates, (rate) => {
//     if (rate.ref_rate_code === ref_rate_code) {
//       rateCodes.push(rate.rate_code);
//     }
//   });
//   return rateCodes;
// }
//
// function fetchLocations(ref_rate_code) {
//   // console.log(`finding equals to ${ref_rate_code}`);
//   let carparkFound = _.find(carparks.carparks, (cp) => cp.pp_code === ref_rate_code);
//
//   if (carparkFound) {
//     return carparkFound.coordinates;
//   } else {
//     return null;
//   }
// }
//
// function structureType(structure_type) {
//   switch (structure_type){
//     case 'K':
//       return "kerbside";
//     case 'S':
//       return "surface";
//     case 'B':
//       return "building";
//     default:
//       return structure_type;
//   }
// }
//
// function vehicleType(vehicle_type) {
//   switch (vehicle_type){
//     case 'C':
//       return "car";
//     case 'M':
//       return "motorcycle";
//     case 'H':
//       return "heavy_vehicle";
//     case 'T':
//       return "trailer";
//     default:
//       return vehicle_type;
//   }
// }

let counter = 0;

_.forEach(smartiesUraCarparksDump, async (carparkItem) => {
  let params = {
    TableName : 'smarties-ura-carparks',
    Item: carparkItem
  };
  try {
    console.log(`inserting ${++counter}`)
    await docClient.putAsync(params)
  } catch (err) {
    console.log(err);
    console.log(carparkItem);
  }
});

//
// ## Creating Table
// ## carparks
//
// ### columns
//
// 1. carpark_code (own code) (hash_key) (pp_code for now)
// 2. pp_code
// 3. carpark_name (string) (sort_key)
// 4. carpark_location (array) [{lat, lng, northings, eastings}]
// 5. carpark_structure_type (string) [kerbside, surface]
// 6. parking_types [list]
// 	a. vehicle_type (enum) [motorcycle, car, heavy_vehicle, trailer]
// 	b. parking_type (enum) [short_term, season_parking_commercial, season_parking_residential, group_parking]
// 	c. rate_code (secondary key from carpark_rates) [list]


// var params = {
//   TableName: "smarties-ura-carparks",
//   KeySchema: [
//     {
//       AttributeName: "carpark_code",
//       KeyType: "HASH"
//     }
//   ],
//   AttributeDefinitions: [
//     {
//       AttributeName: "carpark_code",
//       AttributeType: "S"
//     }
//   ],
//   ProvisionedThroughput: {
//     ReadCapacityUnits: 1,
//     WriteCapacityUnits: 5
//   }
// };
//
// AWS.config.update({
//   region: "us-west-2",
// });
//
// var dynamodb = new AWS.DynamoDB({
//   region: "us-west-2"
// });
//
// dynamoDB.createTable(params, function(err, data) {
//   if (err) console.log(err, err.stack); // an error occurred
//   else     console.log(data);           // successful response
// });


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

// let smartiesUraCarparks = [];
//
// function itemToWrite(groupedCarparks) {
//   let item = {
//     carpark_code: groupedCarparks[0].pp_code,
//     pp_code: groupedCarparks[0].pp_code,
//     carpark_name: utils.toProperCase(groupedCarparks[0].carpark_name.trim()),
//     carpark_location: fetchLocations(groupedCarparks[0].pp_code),
//     carpark_structure_type: structureType(groupedCarparks[0].structure)
//   };
//
//   let parking_types = [];
//
//   _.forEach(groupedCarparks, (cp) => {
//     let type = {
//       vehicle_type: vehicleType(cp.vehicle_category),
//       parking_type: cp.short_term_parking_code ? "short_term" : null,
//       rate_code: fetchRateCodes(cp.short_term_parking_code)
//     };
//     parking_types.push(type)
//   });
//
//   item["parking_types"] = parking_types;
//
//   return item;
// }
//
// _.forEach(uraGroupedCarparks, (groupedCarparks) => {
//   smartiesUraCarparks.push(itemToWrite(groupedCarparks));
// });

// let groupedCarparks = [];
// let group = [];
// let lastPushedRefCode = "";
// _.forEach(uraCarparks, (cp) => {
//
//   if (lastPushedRefCode !== "" && lastPushedRefCode !== cp.pp_code) {
//     groupedCarparks.push(group);
//     group = []; //reset group
//   }
//   group.push(cp);
//   lastPushedRefCode = cp.pp_code;
// })
//
// utils.writeToFile("smartiesUraCarparks.json", JSON.stringify(smartiesUraCarparks, null, 2));
