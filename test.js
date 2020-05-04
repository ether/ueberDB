var ueberDB = require("ueberdb2");

let db = new ueberDB.database("dirty", {filename:"./dirty.db"});
example(db);

// using async
async function example(db){
  await db.init();

  // no need for await because it's already in cache..
  db.set("valueA", {a:1,b:2});

  // using callback
  db.get("valueA", function(err, value){
    db.close(function(){
      process.exit(0);
    });
  });
}
