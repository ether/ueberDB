const expect    = require('chai').expect
const databases = require('./lib/databases.js').databases;
const tests     = require('./lib/tests.js');
const Randexp   = require('randexp');
const ueberDB   = require('ueberdb2test');

let randomVal = new Randexp(/.+/).gen();
console.warn(randomVal);

  describe('test should fail', () => {
    it('should return a string', () => {
      expect('ci with travis').to.equal('ci with travisa');
    });
  });

// For each Database (gets database settings)
for (const database in databases){
  let dbSettings = databases[database];
  // connect to database
  var db = new ueberDB.database(database, dbSettings[database])

  db.init(async function (err){
    if(err){
      console.error(err);
      process.exit(1);
    }
    for (const test in tests.tests){
      console.warn("test", test);
      tests.runTest(test, db);
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

  // For each test [tests.js]
    // Run the test
  // Disconnect from database

/*
function tests(db){
  describe('test', () => {
    it('should return a string', () => {
      expect('ci with travis').to.equal('ci with travis');
    });
  });
}
*/
