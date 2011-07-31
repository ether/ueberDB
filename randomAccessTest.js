/**
 * 2011 Peter 'Pita' Martischka
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
 
var opsPerSecond = 10000;
var keysLength = 1;

var async = require("async");
var ueberDB = require("./CloneAndAtomicLayer");

var db;

var counter = 0;

//the default settings for benchmarking
var bench_settings = {};
//bench_settings["mysql"] = {"user":"root", host: "localhost", "password":"", database: "store"};
bench_settings["mysql"] = {"user":"etherpadlite", host: "localhost", "password":"etherpadlite", database: "etherpadlite"};
bench_settings["sqlite"] = {filename:"var/sqlite3.db"};

if(process.argv.length == 3)
{
  var settings = bench_settings[process.argv[2]];
  db = new ueberDB.database(process.argv[2], settings);

  db.init(function(err)
  {
    if(err) throw err;
    doTests();
  });
}
else
{
  console.error("wrong parameters");
}

function doTests()
{  
  //this the localdb with values like they should be
  var localDB = {};
  var keys = [];
  
  //fill the localdb
  for(var i=0;i<keysLength;i++)
  {
    //generate a key value pair
    var keyName = "key" + i;
    var keyValue = generateObject();
    
    //add to the key names array
    keys.push(keyName);
    
    //save in the localdb and the real db
    localDB[keyName] = keyValue
    db.set(keyName, keyValue);
  }
  
  var operationTypes = ["get", "set", "getsub", "setsub", "remove"];
  var operations = [];
  
  //generate the operations
  for(var i=0;i<opsPerSecond;i++)
  {
    var operation = {};
    
    //choose a operation type
    operation.type = operationTypes[Math.floor(Math.random()*5)];
    
    //choose the key that gets affected by this operation
    operation.key = keys[Math.floor(Math.random()*keys.length)];
    
    //if this a subkey access, choose the subkey
    if(operation.type == "getsub" || operation.type == "setsub")
    {
      operation.subkey = ["sub", "num"];
    }
    
    operations.push(operation);
  }
  
  //run trough all operations, fire them randomly
  async.forEach(operations, function(operation, callback)
  {
    setTimeout(function ()
    {
      counter++;
      
      //get the value and test if its the expected value
      if(operation.type == "get")
      {
        var shouldBeValue = JSON.stringify(localDB[operation.key])
        db.get(operation.key, function(err, value)
        {
          if(JSON.stringify(value) != shouldBeValue)
          {
            console.log("Incorrect value of " + operation.key + ", should be: " + shouldBeValue + ", is " + JSON.stringify(value))
          }
          
          callback(err);
        });
        callback();
      }
      //set the value
      else if(operation.type == "set")
      {
        var value = generateObject();
        localDB[operation.key] = value;
        db.set(operation.key, value);
        callback();
      }
      //get the subvalue and test if its the expected value
      else if(operation.type == "getsub")
      {
        var shouldBeValue = JSON.stringify(localDB[operation.key]["sub"]["num"]);
        
        db.getSub(operation.key, operation.subkey, function(err, value)
        {
          if(JSON.stringify(value) != shouldBeValue)
          {
            console.log("Incorrect subvalue of " + operation.key + ", should be: " + shouldBeValue + ", is " + JSON.stringify(value))
          }
          
          callback(err);
        });
      }
      //set the subvalue
      else if(operation.type == "setsub")
      {
        var value = {num:counter};
        localDB[operation.key]["sub"]["num"] = counter;
        db.setSub(operation.key, operation.subkey, counter);
        callback();
      }
      //remove a value
      else if(operation.type == "remove")
      {
        //localDB[operation.key] = null;
        //db.remove(operation.key);
        callback();
      }
    }, Math.floor(Math.random()*1000));
  },
  function(err)
  {
    if(err) throw err;
    console.log("finished");
    process.exit(0);
  })
}

/** 
 * generates a test object
 */
function generateObject()
{
  return {"str": "str" + counter, sub: {num: counter}};
}

/** 
 * clones an object
 */
function clone(obj)
{
  // Handle the 3 simple types, and null or undefined
  if (null == obj || "object" != typeof obj) return obj;

  // Handle Date
  if (obj instanceof Date)
  {
    var copy = new Date();
    copy.setTime(obj.getTime());
    return copy;
  }

  // Handle Array
  if (obj instanceof Array)
  {
    var copy = [];
    for (var i = 0, len = obj.length; i < len; ++i)
    {
      copy[i] = clone(obj[i]);
    }
    return copy;
  }

  // Handle Object
  if (obj instanceof Object)
  {
    var copy = {};
    for (var attr in obj)
    {
      if (obj.hasOwnProperty(attr)) copy[attr] = clone(obj[attr]);
    }
    return copy;
  }

  throw new Error("Unable to copy obj! Its type isn't supported.");
}
