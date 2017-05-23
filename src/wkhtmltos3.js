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
   wkhtmltos3 [-q queueUrl] [--region] [--maxNumberOfMessages] 
              [--waitTimeSeconds] [--waitTimeSeconds] [--visibilityTimeout] 
              -b bucket [-k key] -e expiresDays
              [--format] [--trim] [--width] [--height]
              [--accessKeyId] [--secretAccessKey]
              [-V verbose] [--wkhtmltoimage]
              [--imagemagick] [--url] [url]

DESCRIPTION
   Convert html page specified by 'url' into a jpg image and
   upload it to amazon s3 into the specified 'bucket' and
   'key'. Can be run as either a single invocation that uses the
   command-line options to identify 'url', 'key', etc. to render
   an html page to an image on s3 -OR- can be launched as a service
   that listens for messages to be posted to an aws SQS queue. If
   '--queueUrl' is specified then it will launch as a service.

   -q, --queueUrl
           url of an aws SQS queue to listen for messages
   --region
           aws availability zone of SQS queue
   --maxNumberOfMessages
           max number of messages to retrieve and process at a time
           (default 5)
   --waitTimeSeconds
           Amount of time to wait for messages before giving up. 
           Values > 0 invoke long polling for efficiency.
           (default 10 seconds)
   --visibilityTimeout
           Amount of time before SQS queue will make a message 
           available to be received again (in case error occurred
           and the message was not processed then deleted)
           (default 20 seconds)
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
    {name: 'queueUrl',     alias: 'q', type: String}, // aws SQS queue name
    {name: 'region',                   type: String}, // aws region (eg: 'us-east-1')
    {name: 'maxNumberOfMessages',      type: Number}, // number to process at a time
    {name: 'waitTimeSeconds',          type: Number}, // >0 causes long polling
    {name: 'visibilityTimeout',        type: Number}, // allow try again in case of fail
    {name: 'bucket',       alias: 'b', type: String},
    {name: 'key',          alias: 'k', type: String},
    {name: 'expiresDays',  alias: 'e', type: Number},
    {name: 'format',                   type: String},
    {name: 'trim',         alias: 't', type: Boolean},
    {name: 'width',                    type: Number},
    {name: 'height',                   type: Number},
    {name: 'accessKeyId',              type: String},
    {name: 'secretAccessKey',          type: String},
    {name: 'verbose',      alias: 'V', type: Boolean},
    {name: 'profile',      alias: 'P', type: Boolean},
    {name: 'help',         alias: '?', type: Boolean},
    {name: 'wkhtmltoimage',            type: String},
    {name: 'imagemagick',              type: String},
    {name: 'url',                      type: String, defaultOption: true}
  ]

  // parse command-line args into options object
  const options = commandLineArgs(optionDefinitions, { partial: true })

  // check for extra options
  if (options._unknown)
    console.log(`WARNING: unknown extra options: ${JSON.stringify(options._unknown)}`)

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
  if (options.queueUrl) {
    if (!options.region) {
      console.error('ERROR: --region is required when --queueUrl is specified')
      process.exit(1)
    }
  }
  else {
    if (!options.bucket || !options.key || !options.url) {
      console.error('ERROR: -b bucket, -k key, and url are required')
      process.exit(1)
    }
  }
  // if (!options.accessKeyId && !process.env.ACCESS_KEY_ID) {
  //   console.error('ERROR: either --accessKeyId option or ACCESS_KEY_ID env var is required')
  //   process.exit(1)
  // }
  // if (!options.secretAccessKey && !process.env.SECRET_ACCESS_KEY) {
  //   console.error('ERROR: either --secretAccessKey option or SECRET_ACCESS_KEY env var is required')
  //   process.exit(1)
  // }

  // set profileLog enabled state
  profileLog.enabled = !!options.profile

  return options
}


function awsConfig() {
  // TODO: check into using: AWS.config.loadFromPath('./config.json')
  // TODO: see: http://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/loading-node-credentials-json-file.html
  const accessKeyId = options.accessKeyId || process.env.ACCESS_KEY_ID
  const secretAccessKey = options.secretAccessKey || process.env.SECRET_ACCESS_KEY
  const region = options.region || process.env.REGION
  let awsAuth = {} // not needed if running within aws environment already
  if (accessKeyId && secretAccessKey) {
    awsAuth = {
      accessKeyId: accessKeyId,
      secretAccessKey: secretAccessKey
    }
  }
  if (region)
    Object.assign(awsAuth, {region: region})
  return awsAuth
}


function logger(options, level, verbose_msg, short_msg) {
  msg = options.verbose ? verbose_msg : short_msg
  if (msg) {
    if (level === 'error')
      console.error(msg)
    else
      console.log(msg)
  }
}


/**
 * Upload file specified by 'imagepath' to Amazon s3.
 *
 * @see https://www.npmjs.com/package/s3
 *
 * @param imagepath {string} path of file to be uploaded to s3
 * @param options {Object} {bucket, key, expiresDays, accessKeyId, secretAccessKey, verbose, url}
 * @param success {function} invoked upon success
 * @param error {function} invoked upon error
 */
function uploadToS3(imagepath, options, success, error) {
  const start = new Date()
  if (options.verbose)
    console.log(`  uploading ${fs.statSync(imagepath).size/1000.0}k to s3...`)
  let expiresDate = null
  if (options.expiresDays)
    expiresDate = moment().add(options.expiresDays, 'days').toDate()

  const S3 = new AWS.S3(awsConfig());

  S3.putObject({
    Bucket: options.bucket,
    Key: options.key,
    Body: fs.createReadStream(imagepath),
    ContentType: 'image/jpeg',
    ACL: "public-read",
    Expires: expiresDate
  }, (error) => {
    if (error) {
      logger(options, 'error',
        `  failed: error = ${error}\n`,
        `wkhtmltos3: fail upload: ${options.url} => s3:${options.bucket}:${options.key} (error = ${error})`
      )
      profileLog.addEntry(start, 'fail s3 upload')
      error()
    }
    else {
      logger(options, 'log',
        `  complete\n`,
        `wkhtmltos3: success: ${options.url} => s3:${options.bucket}:${options.key}`
      )
      profileLog.addEntry(start, 'complete s3 upload')
      success()
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
 * @param success {function} invoked upon success passing (destpath, options)
 * @param error {function} invoked upon error
 */
function imagemagickConvert(imagepath, options, success, error) {
  const start = new Date()
  if (options.verbose)
    console.log(`  imagemagick convert (${JSON.stringify(options.imagemagick)})...`)
  const destpath = `/tmp/imagemagick/${options.key}`
  fs.mkdirsSync(path.dirname(destpath))
  imagemagick.convert([imagepath].concat(options.imagemagick, destpath), function (error, stdout) {
    if (error) {
      logger(options, 'error',
        `  failed: error = ${error.message}\n`,
        `wkhtmltos3: fail imagemagick convert: ${options.url} => s3:${options.bucket}:${options.key} (error = ${error.message})`
      )
      profileLog.addEntry(start, 'fail imagemagick convert')
      error()
    }
    else {
      profileLog.addEntry(start, 'complete imagemagick convert')
      success(destpath, options)
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
 * @param success {function} invoked upon success
 * @param error {function} invoked upon error
 */
function renderPage(options, success, error) {
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
        imagemagickConvert(imagepath, options,
          function(imagepath, options) {
            uploadToS3(imagepath, options, success, error)
          },
          error
        )
      }
      else {
        uploadToS3(imagepath, options, success, error)
      }
    }
    else {
      if (options.verbose)
        console.error(`  failed: code = ${code}${signal ? ` (${signal})`: ''}\n`)
      else
        console.error(`wkhtmltos3: fail render: ${options.url} => s3:${options.bucket}:${options.key} (code = ${code}${signal ? ` (${signal})`: ''})`);
      profileLog.addEntry(start, 'fail wkhtmltoimage generate')
    }
  });
}


function listenOnSqsQueue(options) {
  console.log('listenOnSqsQueue: started')

  const queueUrl = options.queueUrl
  const maxNumberOfMessages = options.maxNumberOfMessages || 5
  const waitTimeSeconds = options.waitTimeSeconds || 10
  const visibilityTimeout = options.visibilityTimeout || 20

  const sqs = new AWS.SQS(awsConfig())

  params = {
    AttributeNames: [
      'SentTimestamp',
      'ApproximateFirstReceiveTimestamp',
      'ApproximateReceiveCount'
    ],
    MaxNumberOfMessages: maxNumberOfMessages,
    QueueUrl: queueUrl,
    VisibilityTimeout: visibilityTimeout,
    WaitTimeSeconds: waitTimeSeconds
  }

  function receiveMessage() {
    sqs.receiveMessage(params, function(error, data) {
      setImmediate(receiveMessage) // loop
      if (error) {
        console.log(`receiveMessage: fail: ${error}`)
      }
      else {
        if (!data.Messages) {
          console.log(`receiveMessage: none (data: ${JSON.stringify(data)})`)
        }
        else {
          console.log(`receiveMessage: success: message:\n${JSON.stringify(data.Messages.map(function(m) {return JSON.parse(m.Body)}), null, 2)}`)
          // TODO: invoke render then delete upon success in callback

          for (let message of data.Messages) {
            Object.assign(options, JSON.parse(message.Body))
            renderPage(
              options,
              function() {
                console.log(`receiveMessage: delete...`)
                const deleteParams = {
                  QueueUrl: queueUrl,
                  ReceiptHandle: data.Messages[0].ReceiptHandle
                }
                sqs.deleteMessage(deleteParams, function(error, data) {
                  if (error) {
                    console.log(`receiveMessage: delete: fail: ${error}`)
                  } else {
                    console.log(`receiveMessage: delete: success: ${JSON.stringify(data)}`)
                  }
                })
                profileLog.writeToConsole()
              },
              function() {
                profileLog.writeToConsole()
              }
            )
          }
        }
      }
    })
  }

  receiveMessage()
}


// ===== main =======================================================
const options = getOptions()

if (options.queueUrl) {
  listenOnSqsQueue(options) // run forever
}
else {
  renderPage( // render one page then exit
    options,
    function() {
      profileLog.writeToConsole()
      process.exit()
    },
    function() {
      profileLog.writeToConsole()
      process.exit(1)
    }
  )
}
