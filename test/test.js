path = require('path'),
fs = require('fs'),
ueberdb = require('../index'),
events = require('events'),
assert = require('assert'),
Randexp = require("randexp"),
databases = require("./lib/databases").databases,
clitable = require("cli-table");

var exists = fs.exists;
var db;

// Basic speed settings, can be overriden on a per database setting
var defaultNumberOfWrites = 20000;
const acceptableWrites = 3;
const acceptableReads = 0.1;
const acceptableRemove = 1;
const acceptableFindKeys = 1;
const CACHE_ON = true;
const CACHE_OFF = false;
var keys = Object.keys(databases);

const table = new clitable({
    head: ['Database', '# of items', 'Write(in seconds)', 'Read(scnds)', 'findKey(scnds)', 'remove(scnds)']
  , colWidths: [20, 10, 20, 15, 15, 15]
});

keys.forEach(async function(database) {
  var dbSettings = databases[database];
  await ueberdbAPITests(database, dbSettings, CACHE_ON)
  await ueberdbAPITests(database, dbSettings, CACHE_OFF)
})

after(function(){
  if(databases.dirty && databases.dirty.filename){
    exists(databases.dirty.filename, function(doesExist) {
      if (doesExist) {
        fs.unlinkSync(databases.dirty.filename);
      }
    });
  }
  console.log(table.toString())
  db.close(); // close the database
  process.exit(0)
});


async function ueberdbAPITests(database, dbSettings, cacheEnabled, done) {
  if(cacheEnabled){
    var cacheStatus = "cache-on";
  }else{
    var cacheStatus = "cache-off"
  }
  describe('ueberdb:' +database + ":"+cacheStatus, function() {

    this.timeout(1000000);
    function init(done) {
      if(dbSettings.filename){
        exists(dbSettings.filename, function(doesExist) {
          if (doesExist) {
            fs.unlinkSync(dbSettings.filename);
          }
        });
      }
      db = new ueberdb.database(database, dbSettings);
      db.init(function(e){
        if(e) throw new Error(e);
        if(!cacheEnabled) db.cache = 0;
        done();
      })
    }

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
        let matches = (typeof output === "undefined" || output == null);
        assert.equal(matches, true);
      });
    });

    // Read/write operations with timers to catch events
    it('Speed is acceptable', () => {
      this.timeout(1000000);
      var input = {a:1,b: new Randexp(/.+/).gen()};
      // var key =  new Randexp(/.+/).gen();
      // TODO setting a key with non ascii chars
      var key = new Randexp(/([a-z]\w{0,20})foo\1/).gen();
      var timers = {};
      timers.start = Date.now();
      let numberOfWrites = (dbSettings.speeds && dbSettings.speeds.numberOfWrites) || defaultNumberOfWrites;
      for (i = 0; i < numberOfWrites; i++){
        db.set( key+i , input );
      }

      timers.written =  Date.now();

      for (i = 0; i < numberOfWrites; i++){
        db.get(key+i, function(err, output){
          if(err) throw new Error("Error .get")
        });
      }
      timers.read = Date.now();

      // do a findKeys Event

      for (i = 0; i < numberOfWrites; i++){
        db.findKeys(key+i, null, function(err, output){
          if(err) throw new Error("Error .findKeys")
        });
      }
      timers.findKeys = Date.now();

      for (i = 0; i < numberOfWrites; i++){
        db.remove(key+i, null, function(err, output){
          if(err) throw new Error("Error .remove")
        });
      }
      timers.remove = Date.now();
      var timeToWrite = timers.written - timers.start;
      var timeToRead = timers.read - timers.written;
      var timeToFindKey = timers.findKeys - timers.read;
      var timeToRemove = timers.remove - timers.findKeys;
/*
      console.log("timeToWrite", timeToWrite);
      console.log("timeToRead", timeToRead);
      console.log("timeToFindKey", timeToFindKey);
      console.log("timeToRemove", timeToRemove);
*/
      var timeToWritePerRecord = timeToWrite/numberOfWrites;
      var timeToReadPerRecord = timeToRead/numberOfWrites;
      var timeToFindKeyPerRecord = timeToFindKey / numberOfWrites;
      var timeToRemovePerRecord = timeToRemove / numberOfWrites;
      table.push([database +":"+cacheStatus, numberOfWrites, timeToWritePerRecord, timeToReadPerRecord, timeToFindKeyPerRecord, timeToRemovePerRecord]);

      var acceptableReadTime = (((dbSettings.speeds && dbSettings.speeds.read) || acceptableReads));
      console.log("ART", acceptableReadTime, timeToReadPerRecord)
      var reads = acceptableReadTime >= timeToReadPerRecord;

      var acceptableWriteTime = (((dbSettings.speeds && dbSettings.speeds.write) || acceptableWrites));
      console.log("AWT", acceptableWriteTime, timeToWritePerRecord)
      var writes = acceptableWriteTime >= timeToWritePerRecord;

      var acceptableFindKeysTime = (((dbSettings.speeds && dbSettings.speeds.findKey) || acceptableFindKeys));
      console.log("AFKT", acceptableFindKeysTime, timeToFindKeyPerRecord)
      var findKeys = acceptableFindKeysTime >= timeToFindKeyPerRecord;

      var acceptableRemoveTime = (((dbSettings.speeds && dbSettings.speeds.remove) || acceptableRemove));
      console.log("ARemT", acceptableRemoveTime, timeToRemovePerRecord)
      var remove = acceptableRemoveTime >= timeToRemovePerRecord;
      assert.equal((reads === writes === findKeys === remove), true);
    });

  });
  //  done
}


// TODO: Need test which prefills with 1e7 of data then does a get.
