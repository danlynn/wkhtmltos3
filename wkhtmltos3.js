// TODO: support pdf in addition to image (see: https://www.npmjs.com/package/wkhtmltox)


const wkhtmltoimage = require('wkhtmltoimage')
const fs = require('fs-extra')
const AWS = require('aws-sdk')
const moment = require('moment')
const commandLineArgs = require('command-line-args')
const path = require('path')


const helpDoc = `
NAME
   wkhtmltos3 - Use webkit to convert html page to image on s3

SYNOPSIS
   wkhtmltos3 -b bucket -k key -e expiresDays
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
   --accessKeyId=ACCESS_KEY_ID
           Amazon accessKeyId that has access to bucket - if not
           provided then 'ACCESS_KEY_ID' env var will be used
   --secretAccessKey=SECRET_ACCESS_KEY
           Amazon secretAccessKey that has access to bucket - if
           not provided then 'SECRET_ACCESS_KEY' env var will be
           used
   -V, --verbose
           provide verbose logging - if not provided then 
           'VERBOSE' env var will be checked
   -h, --help
           display this help
`


// define command-line options
const optionDefinitions = [
  {name: 'bucket',          alias: 'b', type: String},
  {name: 'key',             alias: 'k', type: String},
  {name: 'expiresDays',     alias: 'e', type: Number},
  {name: 'accessKeyId',                 type: String},
  {name: 'secretAccessKey',             type: String},
  {name: 'verbose',         alias: 'V', type: Boolean},
  {name: 'help',            alias: 'h', type: Boolean},
  {name: 'url',                         type: String, defaultOption: true}
]


// validations
const options = commandLineArgs(optionDefinitions)
if (options.help || process.argv.length === 2) {
  console.log(helpDoc)
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


const verbose = options.verbose || process.env.VERBOSE
const accessKeyId = options.accessKeyId || process.env.ACCESS_KEY_ID
const secretAccessKey = options.secretAccessKey || process.env.SECRET_ACCESS_KEY


if (options.verbose)
  console.log(`
wkhtmltos3:
  bucket:      ${options.bucket}
  key:         ${options.key}
  expiresDays: ${options.expiresDays ? options.expiresDays : 'never'}
  url:         ${options.url}
`)


const S3 = new AWS.S3({
	accessKeyId: accessKeyId,
	secretAccessKey: secretAccessKey
});
const imagepath = `/tmp/${options.key}`
fs.mkdirsSync(path.dirname(imagepath))
var expiresDate = null
if (options.expiresDays)
	expiresDate = moment().add(options.expiresDays, 'days').toDate()
if (options.verbose)
  console.log('  rendering jpg...')
wkhtmltoimage.generate(options.url, {output: imagepath}, function (code, signal) {
	if (code == 0) {
    if (options.verbose)
      console.log(`  uploading ${fs.statSync(imagepath).size/1000.0}k to s3...`)
    S3.putObject({
      Bucket: options.bucket,
      Key: options.key,
      Body: fs.createReadStream(imagepath),
      ContentType: 'image/jpeg',
      ACL: "public-read",
      Expires: expiresDate
    }, (error) => {
      if (error != null) {
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
  else {
    if (options.verbose)
      console.error(`  failed: code = ${code}\n`)
    else
      console.error(`wkhtmltos3: fail render: ${options.url} => s3:${options.bucket}:${options.key} (code = ${code})`);
    process.exit(1)
  }
});
