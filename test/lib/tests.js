const Randexp = require("randexp");

exports.tests = {
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
  /* Basic findKeys test functionality */
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
  }



}

exports.runTest = async function(test, db){

  db.close(function(){
    process.exit(0);
  });

}
