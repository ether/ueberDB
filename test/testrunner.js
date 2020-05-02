const assert    = require('assert');
const expect    = require('chai').expect
const databases = require('./lib/databases.js').databases;
const tests     = require('./lib/tests.js');
const ueberDB   = require('../index.js');
const fs        = require('fs');

// For each Database (gets database settings)
for (const database in databases){
  let dbSettings = databases[database];

  if(database === "dirty"){
    fs.unlinkSync(dbSettings.filename);
  }

  var db = new ueberDB.database(database, dbSettings);
  db.dbSettings.cache = 60000;

  console.warn(db.dbSettings);
  // connect to database
  db.init(function (err){
    if(err){
      console.error(err);
      process.exit(1);
    }
    // cache on
    for (const test in tests.tests){
      var testFn = tests.tests[test];
      testFn(db, assert, database+": cache"+dbSettings.cache||0 + " : "+test);
    }
  });
}

/*
Test approaches:
  [*] Fuzzed inc. whitespace
  * Keys not present
  * Large data sets
  * Collect time metrics

Methods:
  > set & get
  > set & find keys
  > set and remove
*/
