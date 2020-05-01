const Randexp = require("randexp");

exports.tests = {
  someTest: function(db, assert, test){
    let randomVal = new Randexp(/.+/).gen();
    // console.warn(randomVal);
  },
  basicReadWrite: function(db, assert, test){
  var input = {a:1,b: new Randexp(/.+/).gen()};
  var key =  new Randexp(/.+/).gen();
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

  }
}

exports.runTest = async function(test, db){

  db.close(function(){
    process.exit(0);
  });

}

