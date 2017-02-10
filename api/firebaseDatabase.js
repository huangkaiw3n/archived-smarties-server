var admin = require("firebase-admin");
var serviceAccount = require(process.env.FIREBASE_AUTH);

let HAS_INITIALIZED = false

const initFirebase = () => {
  if (!HAS_INITIALIZED) {
    var config = {
      credential: admin.credential.cert(serviceAccount),
      databaseURL: "https://parkpark-334b8.firebaseio.com"
    };

    // admin.database.enableLogging(true)
    admin.initializeApp(config)
    HAS_INITIALIZED = true
  }
}

exports.getDatabase = () => {
  initFirebase()
  return admin.database()
}
