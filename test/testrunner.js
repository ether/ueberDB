const assert    = require('assert');
const expect    = require('chai').expect
const databases = require('./lib/databases.js').databases;
const tests     = require('./lib/tests.js');
const ueberDB   = require('../index.js');

// For each Database (gets database settings)
for (const database in databases){
  let dbSettings = databases[database];
  // connect to database
  if(database === "dirty") dbSettings = dbSettings[database];

  var db = new ueberDB.database(database, dbSettings);

  db.init(function (err){
    if(err){
      console.error(err);
      process.exit(1);
    }
    // cache on
    for (const test in tests.tests){
      var testFn = tests.tests[test];
      testFn(db, assert, database+": "+test);
    }
    // cache off
    for (const test in tests.tests){
      delete db.cache;
      var testFn = tests.tests[test];
      testFn(db, assert, database+": "+test);
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
