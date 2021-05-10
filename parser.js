var util = require('util'),
    ChunkedStream = require('chunked-stream'),
    M3U = require('./m3u'),
    PlaylistItem = require('./m3u/PlaylistItem'),
    StreamItem = require('./m3u/StreamItem'),
    IframeStreamItem = require('./m3u/IframeStreamItem'),
    MediaItem = require('./m3u/MediaItem');

// used for splitting strings by commas not within double quotes
var NON_QUOTED_COMMA = /,(?=(?:[^"]|"[^"]*")*$)/;

var m3uParser = module.exports = function m3uParser() {
  ChunkedStream.apply(this, ['\n', true]);

  this.linesRead = 0;
  this.m3u = new M3U;

  this.cueOut = null;
  this.cueOutCont = null;
  this.cueIn = null;
  this.assetData = null;
  this.scteData = null;
  this.dateRangeData = null;

  this.on('data', this.parse.bind(this));
  var self = this;
  this.on('end', function() {
    if(this.cueIn == true) {
		  this.addItem(new PlaylistItem);
		  this.currentItem.set('cuein', true);
		  this.cueIn = null;
			}
    self.emit('m3u', self.m3u);
  });
};

util.inherits(m3uParser, ChunkedStream);

m3uParser.M3U = M3U;

m3uParser.createStream = function() {
  return new m3uParser;
};

m3uParser.prototype.parse = function parse(line) {
  line = line.trim();
  if (this.linesRead == 0) {
    if (line != '#EXTM3U') {
      return this.emit('error', new Error(
        'Non-valid M3U file. First line: ' + line
      ));
    }
    this.linesRead++;
    return true;
  }
  if (['', '#EXT-X-ENDLIST'].indexOf(line) > -1) return true;
  if (line.indexOf('#') == 0) {
    this.parseLine(line);
  } else {
    if (this.currentItem.attributes.uri != undefined) {
      this.addItem(new PlaylistItem);
    }
    this.currentItem.set('uri', line);
    this.emit('item', this.currentItem);
  }
  this.linesRead++;
};

m3uParser.prototype.parseLine = function parseLine(line) {
  var parts = line.slice(1).split(/:(.*)/);
  var tag   = parts[0];
  var data  = parts[1];
  if (typeof this[tag] == 'function') {
    this[tag](data, tag);
  } else {
    this.m3u.set(tag, data);
  }
};

m3uParser.prototype.addItem = function addItem(item) {
  this.m3u.addItem(item);
  this.currentItem = item;
  return item;
};

m3uParser.prototype['EXTINF'] = function parseInf(data) {
  this.addItem(new PlaylistItem);

  data = data.split(',');
  this.currentItem.set('duration', parseFloat(data[0]));
  this.currentItem.set('title', data[1]);
  if (this.playlistDiscontinuity) {
    this.currentItem.set('discontinuity', true);
    this.playlistDiscontinuity = false;
  }
  if (this.cueOut !== null) {
    this.currentItem.set('cueout', this.cueOut);
    this.cueOut = null;
    if (this.assetData !== null) {
      this.currentItem.set('assetdata', this.assetData);
      this.assetData = null;
    }
    if (this.scteData !== null) {
      this.currentItem.set('sctedata', this.scteData);
      this.scteData = null;
    }
  }

  if (this.cueOutCont !== null) {
    this.currentItem.set('cont-offset', this.cueOutCont.offset);
    this.currentItem.set('cont-dur', this.cueOutCont.duration);
    if (this.cueOutCont.scteData) {
      this.currentItem.set('sctedata', this.cueOutCont.scteData);
    }
    this.cueOutCont = null;
  }

  if (this.cueIn !== null) {
    this.currentItem.set('cuein', true);
    this.cueIn = null;
  }

  if (this.dateRangeData !== null) {
    this.currentItem.set('daterange', this.dateRangeData);
    this.dateRangeData = null;
  }
};

m3uParser.prototype['EXT-X-DISCONTINUITY'] = function parseInf() {
  this.playlistDiscontinuity = true;
}

m3uParser.prototype['EXT-X-CUE-OUT'] = function parseInf(data) {
  var attr = this.parseAttributes(data);
  var durationAttr = attr.find(elem => elem.key.toLowerCase() === 'duration');
  if(durationAttr) {
    this.cueOut = durationAttr.value;
  } else {
    const duration = parseInt(data);
    this.cueOut = !isNaN(duration) ? duration : 0;
  }
}

m3uParser.prototype['EXT-X-CUE-OUT-CONT'] = function parseInf(data) {
  const m = data.match(/(\d+\.?\d*)\/(\d+\.?\d*)/);
  if (m) {
    const offset = m[1];
    const duration = m[2];
    this.cueOutCont = { offset: Number(offset), duration: Number(duration) };
  }
  else {
    const cueOutInfo = { offset: false, duration: false }
    for (const match of data.matchAll(/(ElapsedTime|Duration|SCTE35)=([^,]*)/g)) {
      switch(match[1]) {
        case 'ElapsedTime':
          cueOutInfo.offset = Number(match[2]);
          break;
        case 'Duration':
          cueOutInfo.duration = Number(match[2]);
          break;
        case 'SCTE35':
          cueOutInfo.scteData = match[2];
          break;
      }
    }
    if (cueOutInfo.offset !== false && cueOutInfo.duration !== false) {
      this.cueOutCont = cueOutInfo;
    }
  }
}

m3uParser.prototype['EXT-OATCLS-SCTE35'] = function parseInf(data) {
  this.scteData = data;
}

m3uParser.prototype['EXT-X-CUE-IN'] = function parseInf() {
  this.cueIn = true;
}

m3uParser.prototype['EXT-X-ASSET'] = function parseInf(data) {
  this.assetData = data;
};

m3uParser.prototype['EXT-X-BYTERANGE'] = function parseByteRange(data) {
  this.currentItem.set('byteRange', data);
};

m3uParser.prototype['EXT-X-DATERANGE'] = function parseDateRange(data) {
  this.dateRangeData = data;
};

m3uParser.prototype['EXT-X-STREAM-INF'] = function(data) {
  this.addItem(new StreamItem(this.parseAttributes(data)));
};

m3uParser.prototype['EXT-X-I-FRAME-STREAM-INF'] = function(data) {
  this.addItem(new IframeStreamItem(this.parseAttributes(data)));
  this.emit('item', this.currentItem);
};

m3uParser.prototype['EXT-X-MEDIA'] = function(data) {
  this.addItem(new MediaItem(this.parseAttributes(data)));
  this.emit('item', this.currentItem);
};



m3uParser.prototype.parseAttributes = function parseAttributes(data) {
  data = data.split(NON_QUOTED_COMMA);
  var self = this;
  return data.map(function(attribute) {
    var keyValue = attribute.split(/=(.+)/).map(function(str) {
      return str.trim();
    });
    return {
      key   : keyValue[0],
      value : keyValue[1]
    };
  });
};
