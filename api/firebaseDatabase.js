var Firebase = require('firebase');

let HAS_INITIALIZED = false

const initFirebase = () => {
  if (!HAS_INITIALIZED) {
    var config = {
      apiKey: "AIzaSyBzClvv2oiYFWRv1AbpwXz_KK84WiOLA-s",
      authDomain: "parkpark-334b8.firebaseapp.com",
      databaseURL: "https://parkpark-334b8.firebaseio.com",
      storageBucket: "parkpark-334b8.appspot.com",
      messagingSenderId: "141561941074"
    };

    Firebase.database.enableLogging(true)
    Firebase.initializeApp(config)
    HAS_INITIALIZED = true
  }
}

exports.getDatabase = () => {
  initFirebase()
  return Firebase.database()
}
