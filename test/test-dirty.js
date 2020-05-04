const config = require('./config');
path = require('path'),
fs = require('fs'),
etherdb = require(config.LIB_ETHERDB),
events = require('events'),
assert = require('assert');
Randexp = require("randexp");


var exists = fs.exists;
var db;

// Settings.
const numberOfWrites = 100;
const acceptableWritesPerSecond = 0.5;
const acceptableReadsPerSecond = 0.1;
const acceptableFindKeysPerSecond = 1;

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
      db.init(done)
    }

    // before(cleanup);
    before(init);

    describe("white space", function(){

      var input = {a:1,b: new Randexp(/.+/).gen()};
      var key = new Randexp(/.+/).gen();

      // set
      it('Tries to get the value with an included space', () => {
        db.set(key, input);
        db.get(key + " ", function(err, output){
          let matches = JSON.stringify(input) !== JSON.stringify(output);
          assert.equal(matches, true);
        });
      });

      it('Gets the correct item when whitespace is in key', () => {
        //get the input object without whitespace
        db.get(key, function(err, output){
          let matches = JSON.stringify(input) === JSON.stringify(output);
          assert.equal(matches, true);
        });
      });

      var key = new Randexp(/.+/).gen();
      var keyWithSpace = key + " ";
      // set
      // now we do the same but with whiteSpaceInKey
      it('Tries to get the value with an included space', () => {
        db.set(keyWithSpace + " ", input);
        //get the input object with whitespace (shouldn't get it)
        db.get(keyWithSpace + " ", function(err, output){
          let matches = JSON.stringify(input) === JSON.stringify(output);
          assert.equal(matches, true);
        });
        db.get(key, function(err, output){
          let matches = JSON.stringify(input) === JSON.stringify(output);
          // assert.equal(matches, false); TODO this fails in dirty?
        });
      });
    }); // end white space

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
    }); // end basic read writes

    it('Does a basic write->read operation with a random key/value', () => {
      var input = {"testLongString": new Randexp(/[a-f0-9]{50000}/).gen()};
      var key =  new Randexp(/.+/).gen();
      // set long string
      db.set( key , input );

      //get the object
      db.get(key, function(err, output){
        let matches = JSON.stringify(input) === JSON.stringify(output);
        assert.equal(matches, true);
      });
    });

    // Basic findKeys test functionality
    it('Does a basic findKeys operation with a random key/value', () => {
      var input = {a:1,b: new Randexp(/.+/).gen()};
      // TODO setting a key with non ascii chars
      //key = "TODO" + new Randexp(/.+/).gen();
      var key = new Randexp(/([a-z]\w{0,20})foo\1/).gen();
      // set two nested keys under the key
      db.set( key+":test2" , input );
      db.set( key+":test" , input );
      //get the keys of each value
      db.findKeys(key+":*", null, function(err, output){
        for(var keyVal in output){
          // get each value
          db.get(output[keyVal], function(e,output){
            let matches = JSON.stringify(input) === JSON.stringify(output);
            assert.equal(matches, true);
          })
        }
      });
    });

    it('Tests a key has been deleted', () => {
      var input = {a:1,b: new Randexp(/.+/).gen()};
      var key =  new Randexp(/.+/).gen();
      db.set( key , input );

      db.get(key, function(e,output){
        let matches = JSON.stringify(input) === JSON.stringify(output);
        assert.equal(matches, true);
      });

      db.remove(key);

      db.get(key, function(e,output){
        let matches = typeof output === "undefined";
        assert.equal(matches, true);
      });
    });

    it('Makes sure a key is present prior to deleting it - SHOULD FAIL IN DIRTY', () => {
      //// TODO:       if(test.indexOf("dirty") !== -1) return; // dirty doesn't support doBulk
      var input = {a:1,b: new Randexp(/.+/).gen()};
      var key =  new Randexp(/.+/).gen();
      var action = [];
      action.type = "set"
      for (i = 0; i < 10; i++){
        action.push = {
          key: key[i],
          value: input
        }
      }

      for (i = 0; i < 10; i++){
        db.get( key[i], function(e, output){
          let matches = JSON.stringify(input) === JSON.stringify(output);
          assert.equal(matches, true);
        });
      };

    });

    // Read/write operations with timers to catch events
    it('Speed is acceptable', () => {
      var input = {a:1,b: new Randexp(/.+/).gen()};
      // var key =  new Randexp(/.+/).gen();
      // TODO setting a key with non ascii chars
      var key = new Randexp(/([a-z]\w{0,20})foo\1/).gen();
      var timers = {};
      timers.start = Date.now();

      for (i = 0; i < numberOfWrites; i++){
        db.set( key+i , input );
      }

      timers.written =  Date.now();

      for (i = 0; i < numberOfWrites; i++){
        db.get(key+i, function(err, output){
          if(err) throw new Error("Error getting")
        });
      }
      timers.read = Date.now();

      // do a findKeys Event

      for (i = 0; i < numberOfWrites; i++){
        db.findKeys(key+i, null, function(err, output){
          if(err) throw new Error("Error getting")
        });
      }
      timers.findKeys = Date.now();

      var timeToWrite = timers.written - timers.start;
      var timeToRead = timers.read - timers.written;
      var timeToFindKey = timers.findKeys - timers.read;
      var timeToWritePerRecord = timeToWrite/numberOfWrites;
      var timeToReadPerRecord = timeToRead/numberOfWrites;
      var timeToFindKeyPerRecord = timeToFindKey / numberOfWrites;

      console.warn("Time to Write", timeToWrite +"ms");
      console.warn("Time to Read", timeToRead +"ms")
      console.warn("Time to Write Per record", timeToWritePerRecord +"ms");
      console.warn("Time to Read Per record", timeToReadPerRecord +"ms")
      console.warn("Time to FindKey Per record", timeToFindKeyPerRecord +"ms");

      var isAcceptable = (acceptableReadsPerSecond >= timeToReadPerRecord);
      assert.equal(isAcceptable, true);

      var isAcceptable = (acceptableWritesPerSecond >= timeToWritePerRecord);
      assert.equal(isAcceptable, true);

      var isAcceptable = (acceptableFindKeysPerSecond >= timeToFindKeyPerRecord);
      assert.equal(isAcceptable, true);
    });
  });

}

etherdbAPITests(config.TMP_PATH + '/apitest.etherdb');

//////////////////////////////////////////////////
// METHOD Tests


// Basic read/write operation


/*

// remove functionality

// doBulk

////////// BEGIN PERFORMANCE Tests

*/
