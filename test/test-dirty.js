const config = require('./config');
path = require('path'),
fs = require('fs'),
etherdb = require(config.LIB_ETHERDB),
events = require('events'),
assert = require('assert');
Randexp = require("randexp");

var exists = fs.exists;
var db;

function etherdbAPITests(file) {
  describe('etherdb api', function() {
    function cleanup(done) {
      exists(file, function(doesExist) {
        if (doesExist) {
          fs.unlinkSync(file);
        }

        done();
      });
    }

    function init(done) {
      db = new etherdb.database("dirty", {"filename": exports.TMP_PATH });
      console.log("initd")
      db.init(function (err){
        done();
      })
    }

    before(cleanup);
    before(init);

    it('basic read write', function() {

      // Basic read/write operation
      var input = {a:1,b: new Randexp(/.+/).gen()};
      var key =  new Randexp(/.+/).gen();
      // set
      db.set( key , input );
      //get the object
      db.get(key, function(err, output){
        it('Does a basic write->read operation with a random key/value', () => {
          let matches = JSON.stringify(input) === JSON.stringify(output);
          assert.equal(matches, true);
        });
      });

      // assert.ok();
    });

    it('basic read write', function() {

      // Basic read/write operation
      var input = {a:1,b: new Randexp(/.+/).gen()};
      var key =  new Randexp(/.+/).gen();
      // set
      db.set( key , input );
      //get the object
      db.get(key, function(err, output){
        it('Does a basic write->read operation with a random key/value', () => {
          let matches = JSON.stringify(input) === JSON.stringify(output);
          assert.equal(matches, true);
        });
      });

      // assert.ok();
      // beforeEach(cleanup);
      // afterEach(cleanup);

    });

  });
}

etherdbAPITests(config.TMP_PATH + '/apitest.etherdb');
