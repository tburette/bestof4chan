var es = require('event-stream');

function first(){
    return es.through(function write(data){
	this.emit('data', data);
	this.emit('end');
    })
};

module.exports.first = first;

/**
Only let through values that are  in the passer array
Compare using ===
*/
function filterIn(acceptedValues){
    return es.through(function write(data){
	if(acceptedValues.indexOf(data) != -1)
	    this.queue(data);
    });
}

module.exports.filterIn = filterIn;

/**
return  a new object where each object of the array
is put in the new object under the key objectOfArray.key.

e.g.:
[{key: x}, {key: y}, ...] --> {x: {key: x}, y: {key: y}, ...}
*/
function arrayToObject(array, key){
    var ret = {};
    array.forEach(function(elem){
	ret[elem[key]]=elem;
    });
    return ret;
}

module.exports.arrayToObject = arrayToObject;

/**
Turn a stream of arrays  into a stream of the individual values 
eg.: [1, 2] | [3] | ... --> .pipe(flattenArrayStream()) --> 1 | 2 | 3 | ...
*/
function flattenArray(){
    return es.through(function(array){
	array.forEach(function(value){
	    this.queue(value);
	}, this);
    });
}

module.exports.flattenArray = flattenArray;
