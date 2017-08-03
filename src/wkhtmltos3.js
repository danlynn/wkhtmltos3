// TODO: support pdf in addition to image (see: https://www.npmjs.com/package/wkhtmltox)
// TODO: add option to support a "check-render" where it renders again and compares it to the first before continuing
// TODO: look for wkhtmltoimage options for waiting until JS complete before continuing


const childProcess = require('child_process')
const imagemagick = require('imagemagick')            // https://github.com/yourdeveloper/node-imagemagick
const commandLineArgs = require('command-line-args')  // https://github.com/75lb/command-line-args
const AWS = require('aws-sdk')                        // https://github.com/aws/aws-sdk-js
const moment = require('moment')
const fs = require('fs-extra')                        // https://github.com/jprichardson/node-fs-extra
const path = require('path')
const clone = require('clone')
const md5File = require('md5-file')                   // https://github.com/roryrjb/md5-file
const ProfileLog = require('profilelog').default      // https://github.com/danlynn/profilelog


const profileLog = new ProfileLog()


function displayHelp() {
  console.log(`
NAME
   wkhtmltos3 - Use webkit to convert html page to image on s3

SYNOPSIS
   wkhtmltos3 [-VP?] [-q queueUrl] [--region] [--maxNumberOfMessages] 
              [--waitTimeSeconds] [--visibilityTimeout] 
              -b bucket [-k key]
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

   -q, --queueUrl=queueUrl
           url of an aws SQS queue to listen for messages
   --region=region_name
           aws availability zone of SQS queue
   --maxNumberOfMessages=number
           max number of messages to retrieve and process at a time
           (default 5)
   --waitTimeSeconds=number
           Amount of time to wait for messages before giving up. 
           Values > 0 invoke long polling for efficiency.
           (default 10 seconds)
   --visibilityTimeout=number
           Amount of time before SQS queue will make a message 
           available to be received again (in case error occurred
           and the message was not processed then deleted)
           (default 15 seconds)
   -b, --bucket=bucket_name
           amazon s3 bucket destination
   -k, --key=filename
           key in amazon s3 bucket
   --format=format
           image file format (default is jpg)
   --trim
           use imagemagick's trim command to automatically crop
           whitespace from images since html pages always default
           to 1024 wide and the height usually has some padding 
           too
           see: http://www.imagemagick.org/Usage/crop/#trim
   --redundant
           render html page into image twice in parallel. If both 
           image files are NOT identical then repeatedly render again 
           until a newly rendered image matched any of the previously
           rendered images.  Gives up after 3 additional render 
           attempts.
   --width=pixels
           explicitly set the width for wkhtmltoimage rendering
   --height=pixels
           explicitly set the height for wkhtmltoimage rendering
   --accessKeyId=ACCESS_KEY_ID
           Amazon accessKeyId that has access to bucket - if not
           provided then 'ACCESS_KEY_ID' env var will be used.
           If running within the aws environment (ec2, etc)
           then this value is optional.
   --secretAccessKey=SECRET_ACCESS_KEY
           Amazon secretAccessKey that has access to bucket - if
           not provided then 'SECRET_ACCESS_KEY' env var will be
           used. If running within the aws environment (ec2, etc)
           then this value is optional.
   --wkhtmltoimage=json_array
           options (in json array format) to be passed through directly 
           to the wkhtmltoimage cli tool as command line options. 
           (eg: --wkhtmltoimage='["--zoom", 2.0]'). These options will 
           merge into and override any of the regular options 
           (like --width=400, --format=png, etc).
           see: https://wkhtmltopdf.org/usage/wkhtmltopdf.txt
   --imagemagick=json_array
           options (in json array format) to be passed through directly
           to the imagemagick node module. This is a highly flexible
           way to perform additional image manipulation on the rendered
           html page. (eg: --imagemagick='["-trim","-colorspace","Gray",
           "-edge",1,"-negate"]')
   --url=url
           optionally explicitly identify the url instead of just
           tacking it on the end of the command-line options
   -v, --version
           display the current version
   -V, --verbose
           provide verbose logging
   -P, --profile
           log execution timing info at end of run
   -?, --help
           display this help
`)
}


// define command-line options
const optionDefinitions = [
  {name: 'queueUrl',     alias: 'q', type: String}, // aws SQS queue name
  {name: 'region',                   type: String}, // aws region (eg: 'us-east-1')
  {name: 'maxNumberOfMessages',      type: Number}, // number to process at a time
  {name: 'waitTimeSeconds',          type: Number}, // >0 causes long polling
  {name: 'visibilityTimeout',        type: Number}, // allow try again in case of fail
  {name: 'bucket',       alias: 'b', type: String},
  {name: 'key',          alias: 'k', type: String},
  {name: 'format',                   type: String},
  {name: 'trim',         alias: 't', type: Boolean},
  {name: 'redundant',                type: Boolean},// keep rendering until 2 match
  {name: 'width',                    type: Number},
  {name: 'height',                   type: Number},
  {name: 'accessKeyId',              type: String},
  {name: 'secretAccessKey',          type: String},
  {name: 'version',      alias: 'v', type: Boolean},
  {name: 'verbose',      alias: 'V', type: Boolean},
  {name: 'profile',      alias: 'P', type: Boolean},
  {name: 'help',         alias: '?', type: Boolean},
  {name: 'wkhtmltoimage',            type: String},
  {name: 'imagemagick',              type: String},
  {name: 'url',                      type: String, defaultOption: true}
]


/**
 * Validate all of the provided 'options'.
 *
 * @param options {Object} options from commandLineArgs
 * @returns {boolean} true if valid - else false
 */
function validateOptions(options) {
  let errors = []
  if (!options.url)
    errors.push('--url=URL is required')
  if (!options.bucket)
    errors.push('--bucket=BUCKET is required')
  if (!options.key)
    errors.push('--key=KEY is required')
  if (errors.length > 0) {
    console.error(`ERROR:\n  ${errors.join(`\n  `)}`)
    return false
  }
  return true
}


/**
 * Parse any command-line options passed to this script into an
 * options object.  Also performs some validation.
 *
 * @see https://www.npmjs.com/package/command-line-args
 *
 * @param argv {Array} optional argv style array of options to be parsed
 * @param fail {function} invoked upon fail (optional)
 * @returns {Object} options from command-line
 */
function getOptions(argv = null, fail = null) {
  // parse command-line args into options object
  let commandLineArgsOptions = {partial: true}
  if (argv)
    commandLineArgsOptions['argv'] = argv
  const options = commandLineArgs(optionDefinitions, commandLineArgsOptions)

  // check for extra options
  if (options._unknown)
    console.log(`WARNING: unknown extra options: ${JSON.stringify(options._unknown)}`)

  // convert options.wkhtmltoimage from json string into Array instance
  if (options.wkhtmltoimage) {
    const origValue = options.wkhtmltoimage
    try {
      options.wkhtmltoimage = JSON.parse(options.wkhtmltoimage)
      if (!options.wkhtmltoimage instanceof Array) {
        console.error(`ERROR: --wkhtmltoimage json must be an array: ${origValue}`)
        if (fail)
          fail()
      }
    }
    catch (e) {
      console.error(`ERROR: could not parse --wkhtmltoimage json: ${origValue}`)
      if (fail)
        fail()
    }
  }
  else
    options.wkhtmltoimage = []

  // convert options.imagemagick from json string into Array instance
  if (options.imagemagick) {
    const origValue = options.imagemagick
    try {
      options.imagemagick = JSON.parse(options.imagemagick)
      if (!options.imagemagick instanceof Array) {
        console.error(`ERROR: --imagemagick json must be an array: ${origValue}`)
        if (fail)
          fail()
      }
    }
    catch (e) {
      console.error(`ERROR: could not parse --imagemagick json: ${origValue}`)
      if (fail)
        fail()
    }
  }
  else
    options.imagemagick = []

  return options
}


/**
 * Get aws config for accessKeyId, secretAccessKey, region.
 *
 * @returns {{}} object with aws config attributes
 */
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


/**
 * Log to either console.log or console.error depending on 'level'
 * either the 'verbose_msg' or 'short_msg' based upon options.verbose.
 * If options.verbose then the 'verbose_msg' will be logged if provided.
 * Otherwise, nothing will be logged.  'short_msg' works the same way but
 * opposite.  Thus, if only one of the two messages are provided then if
 * its options.verbose does not match then nothing is logged.
 *
 * @param options {{}} command line options object
 * @param level {string} either 'log' or 'error'
 * @param verbose_msg {string} optional
 * @param short_msg {string} optional
 */
function logger(options, level, verbose_msg, short_msg = null) {
  const msg = options.verbose ? verbose_msg : short_msg
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
 * @param options {Object} {bucket, key, accessKeyId, secretAccessKey, verbose, url}
 * @param success {function} invoked upon success
 * @param fail {function} invoked upon fail
 */
function uploadToS3(imagepath, options, success, fail) {
  const start = new Date()
  if (options.verbose)
    console.log(`  uploading ${fs.statSync(imagepath).size/1000.0}k to s3...`)

  const S3 = new AWS.S3(awsConfig());

  let contentType = 'image/*'
  if (!options.format)
    contentType = 'image/jpeg'
  else if (options.format === 'png')
    contentType = 'image/png'
  else if (options.format === 'gif')
    contentType = 'image/gif'

  S3.putObject({
    Bucket: options.bucket,
    Key: options.key,
    Body: fs.createReadStream(imagepath),
    ContentType: contentType,
    ACL: "public-read"
  }, (error) => {
    if (error) {
      logger(options, 'error',
        `  failed: error = ${error}\n`,
        `wkhtmltos3: fail upload: ${options.url} => s3:${options.bucket}:${options.key} (error = ${error})`
      )
      profileLog.addEntry(start, 'fail s3 upload')
      fail()
    }
    else {
      fs.remove(imagepath, error => {
        if (error)
          console.log(`    warning: failed to delete image: ${error}`)
      })
      profileLog.addEntry(start, 'complete s3 upload')
      profileLog.addEntry(options.start, 'total')
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
 * @param options {Object} {bucket, key, accessKeyId, secretAccessKey, verbose, url}
 * @param success {function} invoked upon success passing (destpath, options)
 * @param fail {function} invoked upon fail
 */
function imagemagickConvert(imagepath, options, success, fail) {
  const start = new Date()
  if (options.verbose)
    console.log(`  imagemagick convert (${JSON.stringify(options.imagemagick)})...`)
  const destpath = `/tmp/imagemagick/${options.key}`
  fs.mkdirsSync(path.dirname(destpath))
  imagemagick.convert([imagepath].concat(options.imagemagick, destpath), function (error, stdout) {
    if (error) {
      logger(options, 'error',
        `  failed: error = ${error.message}\n`,
        `wkhtmltos3: fail imagemagick convert: ${options.url} => s3:${options.bucket}:${options.key} (error = ${error.message}, stdout = ${stdout})`
      )
      profileLog.addEntry(start, 'fail imagemagick convert')
      fail()
    }
    else {
      profileLog.addEntry(start, 'complete imagemagick convert')
      fs.remove(imagepath, error => {
        if (error)
          console.log(`    warning: failed to delete original image: ${error}`)
      })
      success(destpath, options)
    }
  })
}


/**
 * Generate an image at 'imagepath' of the html page specified by 'options.url'
 * and configured via the other attributes in 'options'.
 *
 * @param options {Object} only used to pass onto log() for options.verbose value
 * @param imagepath {string} output path of created image
 * @param success {function} invoked upon success
 * @param fail {function} invoked upon fail
 */
function wkhtmltoimage(options, imagepath, success, fail) {
  let cacheDir = '/tmp/wkhtmltoimage_cache'
  fs.mkdirsSync(path.dirname(cacheDir))
  fs.mkdirsSync(path.dirname(imagepath))

  let generateOptions = []
  if (options.width)
    generateOptions.push('--width', String(options.width))
  if (options.height)
    generateOptions.push('--height', String(options.height))
  if (options.format)
    generateOptions.push('--format', options.format)
  if (options.wkhtmltoimage)
    generateOptions = generateOptions.concat(options.wkhtmltoimage)
  generateOptions = generateOptions.concat(['--cache-dir', cacheDir, options.url, imagepath])
  logger(options, 'log', `  wkhtmltoimage (${JSON.stringify(generateOptions)})...`)

  // Note that --javascript-delay normally defaults to 200 ms.  It may be extended
  // to avoid warnings about an iframe taking to long to load - might not help.
  const child = childProcess.execFile('wkhtmltoimage', generateOptions, (error, stdout, stderr) => {
    if (error) {
      logger(options, 'error',
        `  failed: ${error}\n`,
        `wkhtmltos3: fail render: ${options.url} => s3:${options.bucket}:${options.key} (${error})`
      )
      profileLog.addEntry(options.start, 'fail wkhtmltoimage')
      fail()
    }
    else {
      profileLog.addEntry(options.start, 'complete wkhtmltoimage')
      if (!fs.existsSync(imagepath)) {
        logger(options, 'error',
          `  failed: wkhtmltoimage was successful - but no image file exists!\n    stdout:\n${stdout}\n    stderr:\n${stderr}`,
          `wkhtmltos3: fail render: ${options.url} => s3:${options.bucket}:${options.key} (wkhtmltoimage was successful - but no image file exists!)`
        )
        fail()
      }
      else {
        // Display output from wkhtmltoimage filtering out normal progress and info
        // so that only warnings and errors remain.  Note these will always be
        // displayed regardless of verbose option.
        const stdoutFiltered = stdout.replace(/\s\s|\r|\[[=> ]+] \d+%/g, '').replace(/^\n|\n$/mg, '').replace(/\n/g, '\n    - ')
        if (stdoutFiltered.length > 0)
          console.log(`    - ${stdoutFiltered}`)
        const stderrFiltered = stderr.replace(/\s\s|\r|\[[=> ]+] \d+%|Loading page \(\d\/\d\)|Rendering \(\d\/\d\)|Done/g, '').replace(/^\n|\n$/mg, '').replace(/\n/g, '\n    - ')
        if (stderrFiltered.length > 0)
          console.log(`    - ${stderrFiltered}`)
        success()
      }
    }
  })
}


/**
 * Redundantly invoke wkhtmltoimage() until 2 resulting images match.  This
 * compensates for 'wkhtmltoimage' binary occasionally failing to load all
 * static assets.  Works by invoking 2 renders in parallel then verifying that
 * they match.  If they don't match then keep invoking additional renders until
 * the latest render matches any of the preceding images.  Gives up after 3
 * additional renders.
 *
 * @param options {Object} only used to pass onto log() for options.verbose value
 * @param imagepath {string} output path of created image
 * @param success {function} invoked upon success
 * @param fail {function} invoked upon fail
 */
function wkhtmltoimageRedundant(options, imagepath, success, fail) {
  const imagepaths = []
  const imageHashes = new Set()

  function indexedPath(path, index) {
    const match = path.match(/(.*)(\.\w+)/)
    return match[1] + '-' + index + match[2]
  }

  function renderUntilMatchFound() {
    let tempImagePath = indexedPath(imagepath, imagepaths.length + 1)
    imagepaths.push(tempImagePath)

    wkhtmltoimage(options, tempImagePath, () => {
      let hash = md5File.sync(tempImagePath)
      // console.log(`=== md5: ${hash}`)
      options.renderAttempts = imagepaths.length
      if (imageHashes.has(hash) || options.renderAttempts >= 5) {
        let message = 'first 2 renders matched'
        if (options.renderAttempts > 2)
          message = `extra attempts: ${options.renderAttempts - 2}`
        if (options.renderAttempts >= 5)
          message = `gave up after ${options.renderAttempts - 2} extra attempts`
        logger(options, 'log', `  redundancy: success (${message})`)
        fs.moveSync(tempImagePath, imagepath, { overwrite: true })
        // TODO: delete all attempts left
        success()
      }
      else {
        imageHashes.add(hash)
        // Keep trying except for first parallel render. This avoids doing
        // 3 renders when first 2 match.
        if (imageHashes.length >= 2)
          renderUntilMatchFound()
      }
    }, fail)

    if (imagepaths.length < 2) { // initialize by rendering twice
      renderUntilMatchFound()
    }
  }

  renderUntilMatchFound()
}


/**
 * Render the html page specified by 'url' option to jpg image which
 * is then optionally trimmed then uploaded to Amazon s3.
 *
 * @see http://madalgo.au.dk/~jakobt/wkhtmltoxdoc/wkhtmltoimage_0.10.0_rc2-doc.html
 *
 * @param options {Object} {bucket, key, accessKeyId, secretAccessKey, verbose, url}
 * @param success {function} invoked upon success
 * @param fail {function} invoked upon fail
 */
function renderPage(options, success, fail) {
  if (validateOptions(options)) {
    // set profileLog enabled state
    profileLog.enabled = !!options.profile

    const start = new Date()
    options.start = start // used by 'profileLog' in wkhtmltoimage() and uploadToS3()
    if (options.verbose)
      console.log(`
wkhtmltos3:
  bucket:      ${options.bucket}
  key:         ${options.key}
  format:      ${options.format || 'jpg'}
  url:         ${options.url}
`)
    let imagepath = `/tmp/${options.key}`
    const renderFunc = options.redundant ? wkhtmltoimageRedundant : wkhtmltoimage
    renderFunc(options, imagepath, () => {

      // if called as success from imagemagickConvert then it passes the imagepath
      // of the converted image rather than the original non-converted path
      function renderSuccess(imagepath, options) {
        uploadToS3(imagepath, options, () => {
          const elapsed = new Date() - options.start
          logger(options, 'log',
            `  complete (${elapsed} ms)\n`,
            `wkhtmltos3: success (${elapsed} ms): ${options.url} => s3:${options.bucket}:${options.key}`
          )
          success()
        }, fail)
      }

      // invoke imagemagick if needed
      if (options.trim)
        options.imagemagick = ['-trim'].concat(options.imagemagick)
      if (options.imagemagick.length > 0) {
        imagemagickConvert(imagepath, options, renderSuccess, fail)
      }
      else {
        renderSuccess(imagepath, options)
      }
    }, fail)
  }
  else { // invalid options
    fail()
  }
}


/**
 * Merge the attributes of 'overrides' into 'options'.  Any values in
 * 'overrides' will completely replace any existing values in 'options'
 * in the new options object returned.  Note that the original 'options'
 * is left untouched.
 *
 * @param options {Object} original commandLineArgs options
 * @param overrides {Object} attributes to be merged into 'options'
 * @return {Object} new object cloned from 'options' with 'overrides' merged in
 */
function mergeOptions(options, overrides) {
  let newOptions = clone(options)
  Object.assign(newOptions, overrides)
  return newOptions
}


function listenOnSqsQueue(options) {
  console.log('listenOnSqsQueue: started')

  const queueUrl = options.queueUrl
  const maxNumberOfMessages = options.maxNumberOfMessages || 5
  const waitTimeSeconds = options.waitTimeSeconds || 10
  const visibilityTimeout = options.visibilityTimeout || 15

  console.log(`  queueUrl:            ${queueUrl}`)
  console.log(`  region:              ${options.region}`)
  console.log(`  maxNumberOfMessages: ${maxNumberOfMessages}`)
  console.log(`  waitTimeSeconds:     ${waitTimeSeconds}`)
  console.log(`  visibilityTimeout:   ${visibilityTimeout}`)

  if (!options.region) {
    console.error('ERROR: --region is required when --queueUrl is specified')
    process.exit(1)
  }

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
      setImmediate(receiveMessage) // loop as soon as message received/timeout/error
      if (error) {
        console.log(`receiveMessage: fail: ${error}`)
      }
      else {
        if (!data.Messages) {
          // logger(options, 'log', `receiveMessage: none (data: ${JSON.stringify(data)})`)
        }
        else {
          logger(options, 'log', `receiveMessage: success: messages: \n${JSON.stringify(data.Messages.map(function(m) {return JSON.parse(m.Body)}), null, 2)}`)
          for (let message of data.Messages) {
            renderPage(
              mergeOptions(options, JSON.parse(message.Body)),
              function() {
                const deleteParams = {
                  QueueUrl: queueUrl,
                  ReceiptHandle: data.Messages[0].ReceiptHandle
                }
                logger(options, 'log', `receiveMessage: delete...\ndeleteParams: \n${JSON.stringify(deleteParams, null, 2)}`)
                sqs.deleteMessage(deleteParams, function(error, data) {
                  if (error) {
                    console.error(`receiveMessage: delete: fail: ${error}`)
                  } else {
                    logger(options, 'log', `receiveMessage: delete: success: ${JSON.stringify(data)}`)
                  }
                })
                profileLog.writeToConsole(true)
              },
              function() {
                profileLog.writeToConsole(true)
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
const options = getOptions(null, () => {process.exit(1)})

if (options.help || process.argv.length === 2) {
  displayHelp()
  process.exit()
}

if (options.version) {
  let packageJson = JSON.parse(fs.readFileSync('package.json', "utf8"))
  console.log(`${packageJson.name} ${packageJson.version}`)
  process.exit()
}

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
