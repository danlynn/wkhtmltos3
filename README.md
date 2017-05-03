## Supported tags and respective `Dockerfile` links

+ [`0.12.4`,`latest` (0.12.4/Dockerfile)](https://github.com/danlynn/wkhtmltos3/blob/0.12.4/Dockerfile)

This image will execute [wktmltoimage](https://wkhtmltopdf.org) to render an html page specified by an URL to a jpg image and then upload that image to s3.

Note: The current version only supports rendering to jpg images.  Stay tuned for a future release that also supports rendering to PDF.

`wkhtmltopdf 0.12.4 + aws-sdk 2.48.0 + node 4.8.2`

## How to use

The wkhtmltos3 image was originally developed to be invoked as an Amazon EC2 Container Service task that when invoked performs the process of rendering one html page into a jpg image that is stored to s3 and then exits.  However, it can be used in other contexts too.

Assuming that you have [Docker installed](https://www.docker.com/community-edition) locally, the wkhtmltos3 docker container can be invoked as follows:

```bash
$ docker run --rm -e ACCESS_KEY_ID=AKIA000NOTREALKEY000 -e SECRET_ACCESS_KEY=l2r+0000000NotRealSecretAccessKey0000000 danlynn/wkhtmltos3 -V -b my-unique-bucket -k 123/profile12345.jpg -e 1 'http://some.com/retailers/123/users/12345/profile.html'

wkhtmltos3:
  bucket:      my-unique-bucket
  key:         123/profile12345.jpg
  expiresDays: 1
  url:         http://some.com/retailers/123/users/12345/profile.html

  rendering jpg...
  uploading 32.57k to s3...
  complete
```

Note, however, that the ACCESS_KEY_ID and SECRET_ACCESS_KEY environment variables can also be passed as command-line options like:

```bash
$ docker run --rm danlynn/wkhtmltos3 -V -b my-unique-bucket -k 123/profile12345.jpg -e 1 --accessKeyId=AKIA000NOTREALKEY000 --secretAccessKey=l2r+0000000NotRealSecretAccessKey0000000 'http://some.com/retailers/123/users/12345/profile.html'

wkhtmltos3:
  bucket:      my-unique-bucket
  key:         123/profile12345.jpg
  expiresDays: never
  url:         http://some.com/retailers/123/users/12345/profile.html

  rendering jpg...
  uploading 32.57k to s3...
  complete
```

All logging is written to STDOUT and STDERR.  The above example used the -V option to provide verbose output.  Leaving this option off will provide output like:

Success to STDOUT (non-verbose):

```bash
wkhtmltos3: success: http://some.com/retailers/123/users/12345/profile.html => s3:my-unique-bucket:123/profile12345.jpg
```

Failure to STDERR (non-verbose):

```bash
wkhtmltos3: fail upload: http://some.com/retailers/123/users/12345/profile.html => s3:NON-EXISTENT-bucket:123/profile12345.jpg (error = NoSuchBucket: The specified bucket does not exist)
```

## Config: env vars and options

The configuration environment variables and command line options can be displayed with the `-h` or `--help` options:

```
$ docker run --rm danlynn/wkhtmltos3 -h

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
```

