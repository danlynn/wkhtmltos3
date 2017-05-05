// TODO: support pdf in addition to image (see: https://www.npmjs.com/package/wkhtmltox)


const wkhtmltoimage = require('wkhtmltoimage')
const imagemagick = require('imagemagick');
const commandLineArgs = require('command-line-args')
const AWS = require('aws-sdk')
const moment = require('moment')
const fs = require('fs-extra')
const path = require('path')


function displayHelpDoc() {
  console.log(`
NAME
   wkhtmltos3 - Use webkit to convert html page to image on s3

SYNOPSIS
   wkhtmltos3 -b bucket -k key -e expiresDays
              [--trim] [--width] [--height]
              [--accessKeyId] [--secretAccessKey]
              [-V verbose] url

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
   --trim
           use imagemagick's trim command to automatically crop
           whitespace from images since html pages always default
           to 1024 wide and the height usually has some padding 
           too
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
   -V, --verbose
           provide verbose logging
   -h, --help
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
    {name: 'trim',            alias: 't', type: Boolean},
    {name: 'width',                       type: Number},
    {name: 'height',                      type: Number},
    {name: 'accessKeyId',                 type: String},
    {name: 'secretAccessKey',             type: String},
    {name: 'verbose',         alias: 'V', type: Boolean},
    {name: 'help',            alias: 'h', type: Boolean},
    {name: 'url',                         type: String, defaultOption: true}
  ]

  // validations
  const options = commandLineArgs(optionDefinitions)
  if (options.help || process.argv.length === 2) {
    displayHelpDoc()
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
      process.exit(1)
    }
    else {
      if (options.verbose)
        console.log('  complete\n')
      else
        console.log(`wkhtmltos3: success: ${options.url} => s3:${options.bucket}:${options.key}`);
    }
  });
}


/**
 * Trim the file specified by 'imagePath' using imagemagick to remove
 * extra whitespace around the image.
 *
 * @see http://www.imagemagick.org/Usage/crop/#trim
 * @see https://www.npmjs.com/package/imagemagick
 *
 * @param imagepath {string} path of image file to be trimmed
 * @param options {Object} {bucket, key, expiresDays, accessKeyId, secretAccessKey, verbose, url}
 * @param callback {function} invoked upon success passing (trimpath, options)
 */
function trim(imagepath, options, callback) {
  if (options.verbose)
    console.log(`  trimming...`)
  const trimpath = `/tmp/trimmed/${options.key}`
  fs.mkdirsSync(path.dirname(trimpath))
  imagemagick.convert([imagepath, '-trim', `${trimpath}`], function (error, stdout) {
    if (error) {
      if (options.verbose)
        console.error(`  failed: error = ${error.message}\n`)
      else
        console.error(`wkhtmltos3: fail trim: ${options.url} => s3:${options.bucket}:${options.key} (error = ${error.message})`);
      process.exit(1)
    }
    else {
      callback(trimpath, options)
    }
  })
}


/**
 * Render the html page specified by 'url' option to jpg image which
 * is then optionally trimmed then uploaded to Amazon s3.
 *
 * @see https://www.npmjs.com/package/wkhtmltoimage
 *
 * @param options {Object} {bucket, key, expiresDays, accessKeyId, secretAccessKey, verbose, url}
 */
function renderPage(options) {
  if (options.verbose)
    console.log(`
wkhtmltos3:
  bucket:      ${options.bucket}
  key:         ${options.key}
  expiresDays: ${options.expiresDays ? options.expiresDays : 'never'}
  url:         ${options.url}
`)
  let imagepath = `/tmp/${options.key}`
  fs.mkdirsSync(path.dirname(imagepath))
  if (options.verbose) {
    let dimensions = ''
    if (options.width && options.height)
      dimensions = ` (${options.width}x${options.height})`
    if (options.width && !options.height)
      dimensions = ` (width: ${options.width})`
    if (options.height && !options.width)
      dimensions = ` (height: ${options.height})`
    console.log(`  rendering jpg${dimensions}...`)
  }
  let generateOptions = {output: imagepath}
  if (options.width)
    generateOptions.width = String(options.width)
  if (options.height)
    generateOptions.height = String(options.height)
  wkhtmltoimage.generate(options.url, generateOptions, function (code, signal) {
    if (code === 0) {
      if (options.trim) {
        trim(imagepath, options, function(imagepath, options) {
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
      process.exit(1)
    }
  });
}


renderPage(getOptions())
