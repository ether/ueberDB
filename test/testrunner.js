const assert    = require('assert');
const expect    = require('chai').expect
const databases = require('./lib/databases.js').databases;
const tests     = require('./lib/tests.js');
const ueberDB   = require('../CloneAndAtomicLayer.js');

// For each Database (gets database settings)
for (const database in databases){
  let dbSettings = databases[database];
  // connect to database
  var db = new ueberDB.database(database, dbSettings[database])

  db.init(function (err){
    if(err){
      console.error(err);
      process.exit(1);
    }
    for (const test in tests.tests){
      var testFn = tests.tests[test];
      testFn(db, assert, test);
    }
  });
}
/*
Test approaches:
  * Fuzzed inc. whitespace
  * Keys not present
  * Large data sets
  * Collect time metrics

Methods:
  > set & get
  > set & find keys
  > set and remove
*/

