var expect = require('expect.js');

var defaultTestSettings = require('../defaultTestSettings.js');
var ueberDB             = require('../CloneAndAtomicLayer');

describe('.doOperation()', function() {
  context('when operation is "remove"', function() {
    var KEY = 'the key';

    var db;

    before(function(done) {
      // using mongodb only because there are other tests already configured to
      // use it, but could be any DB type
      db = new ueberDB.database('mongodb', defaultTestSettings.mongodb);
      db.init(done);
    });

    after(function(done) {
      db.close(done);
    });

    beforeEach(function(done) {
      // create a value to be removed on the tests
      db.set(KEY, 'any value', null, done);
    });

    context('when a callback is provided', function() {
      it('removes the value and calls the callback', function(done) {
        db.remove(KEY, function() {
          db.findKeys(KEY, null, function(err, keysFound) {
            expect(keysFound).to.have.length(0);
            done();
          });
        });
      });
    });

    // this scenario is important because some clients (like Etherpad) do not provide a
    // callback when calling the "remove" operation
    context('when no callback is provided', function() {
      it('removes the value', function(done) {
        db.remove(KEY);

        // give some time for the value to be removed
        setTimeout(function() {
          db.findKeys(KEY, null, function(err, keysFound) {
            expect(keysFound).to.have.length(0);
            done();
          });
        }, 1000);
      });
    });
  });
});
