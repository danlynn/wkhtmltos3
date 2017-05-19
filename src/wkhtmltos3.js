// TODO: support pdf in addition to image (see: https://www.npmjs.com/package/wkhtmltox)


const wkhtmltoimage = require('wkhtmltoimage')
const imagemagick = require('imagemagick');
const commandLineArgs = require('command-line-args')
const AWS = require('aws-sdk')
const moment = require('moment')
const fs = require('fs-extra')
const path = require('path')
const ProfileLog = require('./profilelog')


const profileLog = new ProfileLog()


function displayHelp() {
  console.log(`
NAME
   wkhtmltos3 - Use webkit to convert html page to image on s3

SYNOPSIS
   wkhtmltos3 -b bucket -k key -e expiresDays
              [--format] [--trim] [--width] [--height]
              [--accessKeyId] [--secretAccessKey]
              [-V verbose] [--wkhtmltoimage]
              [--imagemagick] url

DESCRIPTION
   Convert html page specified by 'url' into a jpg image and
   upload it to amazon s3 into the specified 'bucket' and
   'key'.

   -b, --bucket
           amazon s3 bucket destination
   -k, --key
           key in amazon s3 bucket
   -e, --expiresDays
           number of days after which s3 should delete the file
   --format
           image file format (default is jpg)
   --trim
           use imagemagick's trim command to automatically crop
           whitespace from images since html pages always default
           to 1024 wide and the height usually has some padding 
           too
           see: http://www.imagemagick.org/Usage/crop/#trim
   --width
           explicitly set the width for wkhtmltoimage rendering
   --height
           explicitly set the height for wkhtmltoimage rendering
   --accessKeyId=ACCESS_KEY_ID
           Amazon accessKeyId that has access to bucket - if not
           provided then 'ACCESS_KEY_ID' env var will be used
   --secretAccessKey=SECRET_ACCESS_KEY
           Amazon secretAccessKey that has access to bucket - if
           not provided then 'SECRET_ACCESS_KEY' env var will be
           used
   --wkhtmltoimage
           options (in json format) to be passed through directly to 
           the wkhtmltoimage node module. These options are camel-cased 
           versions of all the regular command-line options 
           (eg: --wkhtmltoimage='{"zoom": 1.5}'). These options will 
           merge into and override any of the regular options 
           (like --width=400, --format=png, etc).
           see: https://wkhtmltopdf.org/usage/wkhtmltopdf.txt
   --imagemagick
           options (in json array format) to be passed through directly
           to the imagemagick node module. This is a highly flexible
           way to perform additional image manipulation on the rendered
           html page. (eg: --imagemagick='["-trim","-colorspace","Gray",
           "-edge",1,"-negate"]')
   --url
           optionally explicitly identify the url instead of just
           tacking it on the end of the command-line options
   -V, --verbose
           provide verbose logging
   -P, --profile
           log execution timing info at end of run
   -?, --help
           display this help
`)
}


/**
 * Parse any command-line options passed to this script into an
 * options object.  Also performs some validation.
 *
 * @see https://www.npmjs.com/package/command-line-args
 *
 * @returns {Object} options from command-line
 */
function getOptions() {
  // define command-line options
  const optionDefinitions = [
    {name: 'bucket',          alias: 'b', type: String},
    {name: 'key',             alias: 'k', type: String},
    {name: 'expiresDays',     alias: 'e', type: Number},
    {name: 'format',                      type: String},
    {name: 'trim',            alias: 't', type: Boolean},
    {name: 'width',                       type: Number},
    {name: 'height',                      type: Number},
    {name: 'accessKeyId',                 type: String},
    {name: 'secretAccessKey',             type: String},
    {name: 'verbose',         alias: 'V', type: Boolean},
    {name: 'profile',         alias: 'P', type: Boolean},
    {name: 'help',            alias: '?', type: Boolean},
    {name: 'wkhtmltoimage',               type: String},
    {name: 'imagemagick',                 type: String},
    {name: 'url',                         type: String, defaultOption: true}
  ]

  // parse command-line args into options object
  const options = commandLineArgs(optionDefinitions)

  // convert options.wkhtmltoimage from json string into Object instance
  if (options.wkhtmltoimage) {
    const origValue = options.wkhtmltoimage
    try {
      options.wkhtmltoimage = JSON.parse(options.wkhtmltoimage)
    }
    catch (e) {
      console.error(`ERROR: could not parse --wkhtmltoimage json: ${origValue}`)
      process.exit(1)
    }
  }

  // convert options.imagemagick from json string into Array instance
  if (options.imagemagick) {
    const origValue = options.imagemagick
    try {
      options.imagemagick = JSON.parse(options.imagemagick)
    }
    catch (e) {
      console.error(`ERROR: could not parse --imagemagick json: ${origValue}`)
      process.exit(1)
    }
    if (!options.imagemagick instanceof Array) {
      console.error(`ERROR: --imagemagick json must be an array: ${origValue}`)
      process.exit(1)
    }
  }
  else
    options.imagemagick = []

  // validations
  if (options.help || process.argv.length === 2) {
    displayHelp()
    process.exit()
  }
  if (!options.bucket || !options.key || !options.url) {
    console.error('ERROR: -b bucket, -k key, and url are required')
    process.exit(1)
  }
  if (!options.accessKeyId && !process.env.ACCESS_KEY_ID) {
    console.error('ERROR: either --accessKeyId option or ACCESS_KEY_ID env var is required')
    process.exit(1)
  }
  if (!options.secretAccessKey && !process.env.SECRET_ACCESS_KEY) {
    console.error('ERROR: either --secretAccessKey option or SECRET_ACCESS_KEY env var is required')
    process.exit(1)
  }

  // set profileLog enabled state
  profileLog.enabled = options.profile ? true : false

  return options
}


/**
 * Upload file specified by 'imagepath' to Amazon s3.
 *
 * @see https://www.npmjs.com/package/s3
 *
 * @param imagepath {string} path of file to be uploaded to s3
 * @param options {Object} {bucket, key, expiresDays, accessKeyId, secretAccessKey, verbose, url}
 */
function uploadToS3(imagepath, options) {
  const start = new Date()
  if (options.verbose)
    console.log(`  uploading ${fs.statSync(imagepath).size/1000.0}k to s3...`)
  const accessKeyId = options.accessKeyId || process.env.ACCESS_KEY_ID
  const secretAccessKey = options.secretAccessKey || process.env.SECRET_ACCESS_KEY
  let expiresDate = null
  if (options.expiresDays)
    expiresDate = moment().add(options.expiresDays, 'days').toDate()

  const S3 = new AWS.S3({
    accessKeyId: accessKeyId,
    secretAccessKey: secretAccessKey
  });

  S3.putObject({
    Bucket: options.bucket,
    Key: options.key,
    Body: fs.createReadStream(imagepath),
    ContentType: 'image/jpeg',
    ACL: "public-read",
    Expires: expiresDate
  }, (error) => {
    if (error) {
      if (options.verbose)
        console.error(`  failed: error = ${error}\n`);
      else
        console.error(`wkhtmltos3: fail upload: ${options.url} => s3:${options.bucket}:${options.key} (error = ${error})`);
      profileLog.addEntry(start, 'fail s3 upload')
      profileLog.writeToConsole()
      process.exit(1)
    }
    else {
      if (options.verbose)
        console.log('  complete\n')
      else
        console.log(`wkhtmltos3: success: ${options.url} => s3:${options.bucket}:${options.key}`);
      profileLog.addEntry(start, 'complete s3 upload')
      profileLog.writeToConsole()
    }
  });
}


/**
 * Perform imagemagick convert command on the file specified by 'imagePath'
 * with the specified 'options'.
 *
 * @see http://www.imagemagick.org/Usage/crop/#trim
 * @see https://www.npmjs.com/package/imagemagick
 *
 * @param imagepath {string} path of image file to be trimmed
 * @param options {Object} {bucket, key, expiresDays, accessKeyId, secretAccessKey, verbose, url}
 * @param callback {function} invoked upon success passing (destpath, options)
 */
function imagemagickConvert(imagepath, options, callback) {
  const start = new Date()
  if (options.verbose)
    console.log(`  imagemagick convert (${JSON.stringify(options.imagemagick)})...`)
  const destpath = `/tmp/imagemagick/${options.key}`
  fs.mkdirsSync(path.dirname(destpath))
  imagemagick.convert([imagepath].concat(options.imagemagick, destpath), function (error, stdout) {
    if (error) {
      if (options.verbose)
        console.error(`  failed: error = ${error.message}\n`)
      else
        console.error(`wkhtmltos3: fail imagemagick convert: ${options.url} => s3:${options.bucket}:${options.key} (error = ${error.message})`);
      profileLog.addEntry(start, 'fail imagemagick convert')
      profileLog.writeToConsole()
      process.exit(1)
    }
    else {
      profileLog.addEntry(start, 'complete imagemagick convert')
      callback(destpath, options)
    }
  })
}


/**
 * Render the html page specified by 'url' option to jpg image which
 * is then optionally trimmed then uploaded to Amazon s3.
 *
 * @see https://www.npmjs.com/package/wkhtmltoimage
 * @see http://madalgo.au.dk/~jakobt/wkhtmltoxdoc/wkhtmltoimage_0.10.0_rc2-doc.html
 *
 * @param options {Object} {bucket, key, expiresDays, accessKeyId, secretAccessKey, verbose, url}
 */
function renderPage(options) {
  const start = new Date()
  if (options.verbose)
    console.log(`
wkhtmltos3:
  bucket:      ${options.bucket}
  key:         ${options.key}
  format:      ${options.format || 'jpg'}
  expiresDays: ${options.expiresDays ? options.expiresDays : 'never'}
  url:         ${options.url}
`)
  let imagepath = `/tmp/${options.key}`
  fs.mkdirsSync(path.dirname(imagepath))
  let generateOptions = {}
  if (options.width)
    generateOptions.width = String(options.width)
  if (options.height)
    generateOptions.height = String(options.height)
  if (options.format)
    generateOptions.format = options.format
  if (options.wkhtmltoimage)
    Object.assign(generateOptions, options.wkhtmltoimage)
  if (options.verbose)
    console.log(`  wkhtmltoimage generate (${JSON.stringify(generateOptions)})...`)
  Object.assign(generateOptions, {output: imagepath})
  wkhtmltoimage.generate(options.url, generateOptions, function (code, signal) {
    if (code === 0) {
      profileLog.addEntry(start, 'complete wkhtmltoimage generate')
      if (options.trim)
        options.imagemagick = ['-trim'].concat(options.imagemagick)
      if (options.imagemagick.length > 0) {
        imagemagickConvert(imagepath, options, function(imagepath, options) {
          uploadToS3(imagepath, options)
        })
      }
      else {
        uploadToS3(imagepath, options)
      }
    }
    else {
      if (options.verbose)
        console.error(`  failed: code = ${code}${signal ? ` (${signal})`: ''}\n`)
      else
        console.error(`wkhtmltos3: fail render: ${options.url} => s3:${options.bucket}:${options.key} (code = ${code}${signal ? ` (${signal})`: ''})`);
      profileLog.addEntry(start, 'fail wkhtmltoimage generate')
      profileLog.writeToConsole()
      process.exit(1)
    }
  });
}


renderPage(getOptions())
