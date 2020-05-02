const Randexp = require("randexp");

// Settings.
const numberOfWrites = 100;
const acceptableWritesPerSecond = 0.5;
const acceptableReadsPerSecond = 0.1;
const acceptableFindKeysPerSecond = 1;

//Tests
exports.tests = {

  ////////// BEGIN PERFORMANCE Tests

  /* Read/write operations with timers to catch events */
  performanceLotsOfWrites: function(db, assert, test){
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

    describe(test, () => {
      it('read speed is acceptable', () => {
        let isAcceptable = (acceptableReadsPerSecond >= timeToReadPerRecord);
        assert.equal(isAcceptable, true);
      });
    });

    describe(test, () => {
      it('write speed is acceptable', () => {
        let isAcceptable = (acceptableWritesPerSecond >= timeToWritePerRecord);
        assert.equal(isAcceptable, true);
      });
    });

    describe(test, () => {
      it('findkeys speed is acceptable', () => {
        let isAcceptable = (acceptableFindKeysPerSecond >= timeToFindKeyPerRecord);
        assert.equal(isAcceptable, true);
      });
    });

  },

  //////////////////////////////////////////////////
  // METHOD Tests

  whiteSpaceInKey: function(db, assert, test){
    var input = {a:1,b: new Randexp(/.+/).gen()};

    var key =  new Randexp(/.+/).gen();
    // set
    db.set(key, input);
    //get the input object with whitespace (shouldn't get it)
    db.get(key + " ", function(err, output){
      describe(test, () => {
        it('Tries to get the value with an included space', () => {
          let matches = JSON.stringify(input) !== JSON.stringify(output);
          assert.equal(matches, true);
        });
      });
    });

    //get the input object without whitespace
    db.get(key, function(err, output){
      describe(test, () => {
        it('Gets the correct item when whitespace is in key', () => {
          let matches = JSON.stringify(input) === JSON.stringify(output);
          assert.equal(matches, true);
        });
      });
    });

    // now we do the same but with whiteSpaceInKey
    var key =  new Randexp(/.+/).gen();
    // set
    db.set(key + " ", input);
    //get the input object with whitespace (shouldn't get it)
    db.get(key + " ", function(err, output){
      describe(test, () => {
        it('Tries to get the value with an included space', () => {
          let matches = JSON.stringify(input) === JSON.stringify(output);
          assert.equal(matches, true);
        });
      });
    });

    //get the input object without whitespace
    db.get(key, function(err, output){
      describe(test, () => {
        it('Tries to get key that has whitespace in Key', () => {
          let matches = JSON.stringify(input) !== JSON.stringify(output);
          assert.equal(matches, true);
        });
      });
    });

  },


  /* Basic read/write operation */
  basicReadWrite: function(db, assert, test){
    var input = {a:1,b: new Randexp(/.+/).gen()};
    var key =  new Randexp(/.+/).gen();
    // set
    db.set( key , input );

    //get the object
    db.get(key, function(err, output){
      describe(test, () => {
        it('Does a basic write->read operation with a random key/value', () => {
          let matches = JSON.stringify(input) === JSON.stringify(output);
          assert.equal(matches, true);
        });
      });
    });
  },



  /* Basic read/write operation */
  longStringWrite: function(db, assert, test){
    var input = {"testLongString": new Randexp(/[a-f0-9]{50000}/).gen()};
    var key =  new Randexp(/.+/).gen();
    // set long string
    db.set( key , input );

    //get the object
    db.get(key, function(err, output){
      describe(test, () => {
        it('Does a basic write->read operation with a random key/value', () => {
          let matches = JSON.stringify(input) === JSON.stringify(output);
          assert.equal(matches, true);
        });
      });
    });
  },


  /* Basic findKeys test functionality */
  findKeys: function (db, assert, test){
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
          describe(test, () => {
            it('Does a basic findKeys operation with a random key/value', () => {
              let matches = JSON.stringify(input) === JSON.stringify(output);
              assert.equal(matches, true);
            });
          });
        })
      }
    });
  },

  /* remove functionality */
  remove: function (db, assert, test){
    var input = {a:1,b: new Randexp(/.+/).gen()};
    var key =  new Randexp(/.+/).gen();
    db.set( key , input );

    db.get(key, function(e,output){
      describe(test, () => {
        it('Makes sure a key is present prior to deleting it', () => {
          let matches = JSON.stringify(input) === JSON.stringify(output);
          assert.equal(matches, true);
        });
      });
    });

    db.remove(key);

    db.get(key, function(e,output){
      describe(test, () => {
        it('Tests a key has been deleted', () => {
          let matches = typeof output === "undefined";
          assert.equal(matches, true);
        });
      });
    });
  },

  // doBulk
  doBulk: function (db, assert, test){
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
        describe(test, () => {
          it('Makes sure a key is present prior to deleting it', () => {
            let matches = JSON.stringify(input) === JSON.stringify(output);
            assert.equal(matches, true);
          });
        });
      } );

    };
  }
}
