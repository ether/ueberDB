var ueberDB = require("ueberdb2");
var Randexp = require("randexp");

let db = new ueberDB.database("mysql", {
  "user" : "ueberdb",
  "host" : "localhost",
  "password": "ueberdb", // using async async function example(db){
  "database": "ueberdb",
  "charset" : "utf8mb4"
});
db.init(function(){

  console.log(typeof db.set)

  console.log(typeof db.get)

  console.log(typeof db.doBulk)
  var input = {a:1,b: new Randexp(/.+/).gen()};
  var key = new Randexp(/.+/).gen();
  var action = [];
  action.type = "set"
  for (i = 0; i < 10; i++){
    action.push = {
      key: key[i],
      value: input
    }
  }
  //  db.doBulk(action);
  for (i = 0; i < 10; i++){

    db.setKeys()
    db.get( key[i], function(e, output){
      let matches = JSON.stringify(input) === JSON.stringify(output);
      console.log(input, output);

    });
  };

});
