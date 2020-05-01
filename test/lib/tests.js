exports.tests = {
  someTest: function(db){
  },
  someOtherTest: function(db){

  }
}

exports.runTest = async function(test, db){
  var input = {a:1,b:2};
  await db.set("valueA" , input );

  //get the object
  db.get("valueA", function(err, output){

    describe(test, () => {
console.log("foo", input, output);
      it('should pass obv..', () => {
        expect(JSON.stringify.input).to.equal(JSON.stringify(output));
      });
    });

  });

  db.close(function(){
    process.exit(0);
  });

}

