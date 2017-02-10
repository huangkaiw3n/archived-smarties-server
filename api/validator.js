var jsonv = require('ajv');

// Set up validations

// POST /parkCar
const postParkCarBodySchema = {
  type: 'object',
  required: [
    'carpark_code',
    'license_plate',
    'vehicle_type',
    'lot_number',
    'duration',
    'expectedPrice',
    'stripeTokenId'
  ],
  properties: {
    carpark_code: {
      type: 'string'
    },
    license_plate: {
      type: 'string',
      format: 'carplate'
    },
    vehicle_type: {
      type: 'string',
      enum: ['car', 'motorcycle', 'heavy_vehicle']
    },
    lot_number: {
      type: 'string'
    },
    duration: {
      type: 'number'
    },
    expectedPrice: {
      type: 'number'
    },
    stripeTokenId: {
      type: 'string'
    }
  }
};

// load schema into the validator
var validateParkCarBody = new jsonv();
validateParkCarBody.addFormat('carplate', /^([a-zA-Z]{1,3})(\d{1,5})([a-zA-Z]{1,2})$/);

exports.postParkCarValidator = validateParkCarBody.compile(postParkCarBodySchema);
