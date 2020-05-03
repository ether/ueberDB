var path = require('path'),
  fs = require('fs'),
  rimraf = require('rimraf');

var TMP_PATH = path.join(__dirname, 'tmp'),
  LIB_ETHERDB = path.join(__dirname, '../index');

rimraf.sync(TMP_PATH);
fs.mkdirSync(TMP_PATH);

module.exports = {
  TMP_PATH: TMP_PATH,
  LIB_ETHERDB: LIB_ETHERDB
};
