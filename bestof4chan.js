var fs = require('fs');
var util = require('util');
var request = require('request');
var async = require('async');
var es = require('event-stream');
var concat = require('concat-stream');
var JSONStream = require('JSONStream')
var cheerio = require('cheerio');
var first = require('./myutils.js').first;
var filterIn = require('./myutils.js').filterIn;
var arrayToObject = require('./myutils.js').arrayToObject;
var flattenArray = require('./myutils.js').flattenArray;

function usage(){
    console.log('Usage: ' +
		'bestof4chan board [thread-number] minimum-times-quoted');
}

function errorArgsExit(message){
    usage();
    if(message) console.error(message);
    process.exit();
}

if(process.argv.length < 3){
    errorArgsExit("Missing board");
}
var board = process.argv[2];

try{
    fs.mkdirSync(board);
}catch(exception){
    //windows compatibility?
    if(exception.code != 'EEXIST')
	throw exception;
}

if(process.argv.length < 4){
    errorArgsExit("Missing min quotelinks");
}

var threadNumber;
if(process.argv.length == 5){
    threadNumber = process.argv[3];
    var minQuoteLinks = process.argv[4];    
}else{
    var minQuoteLinks = process.argv[3];
}

//parseInt accepts stuff like '1.2x'
minQuoteLinks = parseInt(minQuoteLinks);
if(minQuoteLinks === NaN){
    errorArgsExit("minimum-times-quoted not a valid number");
}

if( (threadNumber = parseInt(threadNumber)) === NaN)
    errorArgsExit('Invalid thread-number');


var CATALOG_URL = 'http://a.4cdn.org/%s/threads.json';
var THREAD_URL = 'http://a.4cdn.org/%s/thread/%s.json';
var IMAGE_URL = 'http://i.4cdn.org/%s/%s%s';

function threadJSONString(){
    function getThreadJSONString(threadNumber, callback){
	var concatGet = concat(function finishedConcat(allData){
	    callback(null, allData);
	});
	request.get(util.format(THREAD_URL, 
				board, 
				threadNumber)).pipe(concatGet);
    };
    return es.map(getThreadJSONString);
}

function backlinks(postText){
    var backlinks = [];
    $ = cheerio.load(postText);
    $('.quotelink').each(function(index, value){
	var href = value.attribs.href;
	if(href.match(/^#p.*/)){
	    backlinks.push(parseInt(href.slice(2)));
	}
    });
    return backlinks;
}

function postQuoteLinksAdder(posts){
    var postsObj = arrayToObject(posts, 'no');
    function addPostQuoteLinks(post){
	//all posts (included non quoted ones) must have a references property
	post.references = post.references || [];
	backlinks(post.com || '').forEach(function(referencedPostID){
	    var referencedPost = postsObj[referencedPostID];
	    if(referencedPost){
		referencedPost.references = referencedPost.references || [];
		referencedPost.references.push(post);
	    }
	});    
    }
    //should be a writable stream instead of a read/write
    return es.through(function(post){
	this.queue(post);
	addPostQuoteLinks(post);
    });
}

function addQuoteLinkReferences(posts, callback){
    es.readArray(posts)
    .pipe(postQuoteLinksAdder(posts))
    .on('end', function(){
	callback(null, posts);
    });
}

function filterMinTimesQuoted(minQuoteLinks){
    function filterMinTimesQuoted(post){
	if(post.references.length >= minQuoteLinks)
	    this.queue(post);
    }
    return es.through(filterMinTimesQuoted);
}

function filterAnimated(){
    function filterAnimated(post){
	if(post.ext && (post.ext == '.webm' || post.ext == '.gif'))
	    this.queue(post);
    }
    return es.through(filterAnimated);
}

function hasImage(post){
    return (post.filename && post.ext);
}

function imageFilename(post){
    if(!hasImage(post))
	return null;
    return util.format('%s%s', post.no + '-' + post.filename, post.ext);
}

function imageHTML(post){
    if(!hasImage(post))
	return null;
    if(post.ext == '.webm')
	var imageFormat = '<video autoplay loop="" controls src="%s"></video>';
    else
	var imageFormat = '<img src="%s">';
    return util.format(imageFormat, imageFilename(post));
}

function postLinkHTML(board, postno, threadno){
    return util.format(
	'<a href="http://boards.4chan.org/%s/thread/%s">&gt;&gt;%s</a><br>', 
	board, 
	threadno ? threadno+'#p'+postno : postno,
	postno);
}

function saveText(post){
    var content = post.com || '';
    content += postLinkHTML(board, post.no, post.resto);
    content += imageHTML(post) || '';
    content += '<br>\n\nReplies:\n<br>';
    post.references.forEach(function(replyPost){
	content+= '<div class="reply">'+ (replyPost.com || '') + '</div>\n\n';
    });

    fs.writeFile(util.format('%s/%s.html', board, post.no),
		content,
		function(err){
		    if(err)
			console.error(err);
		});
}

function textSaver(){
    return es.through(function(post){
	saveText(post);
	this.queue(post);
    })
}

function saveImage(post, callback){
    if(!hasImage(post)){
	callback();
	return;
    }

    var filename = board + '/' + imageFilename(post);
    if(fs.existsSync(filename)){
	callback();
        return;
    }
    
    var uri = util.format(IMAGE_URL, board, post.tim, post.ext);;
    console.log('downloading ' + uri + ' to ' +  filename);
    request.get(uri)
	.on('error', function(e){
	    console.error(e);
	    callback(e);
	})
        .on('end', function(){
	    console.log('finished downloading ' + uri + ' to ' +  filename)
	    callback();
	})
	.pipe(fs.createWriteStream(filename))
	.on('error', function(e){
	    console.error(e);
	    callback(e);
	});
}

function imageSaver(){
    var queue = async.queue(saveImage, 4);
    //queue.saturated = function(){console.log('Image saver queue saturated')};
    return es.through(function(post){
	queue.push(post);
	this.queue(post);
    });
}


request.get(util.format(CATALOG_URL, board))
.pipe(JSONStream.parse('*.threads.*.no'))//thread numbers
.pipe(threadNumber ? filterIn([threadNumber]) : es.through())
//.pipe(first())//debug
//es.readArray([484160])//debug
.pipe(threadJSONString())
.pipe(JSONStream.parse('posts'))
.pipe(es.map(addQuoteLinkReferences))
.pipe(flattenArray())//stream of arrays of posts to stream of posts
.pipe(filterMinTimesQuoted(minQuoteLinks))
//.pipe(filterAnimated())
.pipe(imageSaver())
.pipe(textSaver())
//.pipe(es.stringify())
//.pipe(process.stdout)
