### Supported tags and respective `Dockerfile` links

+ [`1.0.0`,`latest` (1.0.0/Dockerfile)](https://github.com/danlynn/wkhtmltos3/blob/1.0.0/Dockerfile)

This image will execute [wktmltoimage](https://wkhtmltopdf.org) to render an html page specified by an URL to a jpg image and then upload that image to s3.

Note: The current version only supports rendering to jpg images.  Stay tuned for a future release that also supports rendering to PDF.

`wkhtmltopdf/wkhtmltoimage 0.12.4 + aws-sdk 2.48.0 + imagemagick 8:6.8.9.9-5+deb8u8 + node 6.10.2`

### How to use

The wkhtmltos3 image was originally developed to be invoked as an Amazon EC2 Container Service task that when invoked performs the process of rendering one html page into a jpg image that is stored to s3 and then exits.  However, it can be used in other contexts too.

Assuming that you have [Docker installed](https://www.docker.com/community-edition) locally, the wkhtmltos3 docker container can be invoked as follows:

```bash
$ docker run --rm -e ACCESS_KEY_ID=AKIA000NOTREALKEY000 -e SECRET_ACCESS_KEY=l2r+0000000NotRealSecretAccessKey0000000 danlynn/wkhtmltos3 -V -b my-unique-bucket -k 123/profile12345.jpg -e 1 'http://some.com/retailers/123/users/12345/profile.html'

wkhtmltos3:
  bucket:      my-unique-bucket
  key:         123/profile12345.jpg
  format:      jpg
  expiresDays: 1
  url:         http://some.com/retailers/123/users/12345/profile.html

  rendering...
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

### Config: env vars and options

The configuration environment variables and command line options can be displayed with the `-?` or `--help` options:

```
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
           (eg: --options='{"zoom": 1.5}'). These options will 
           merge into and override any of the regular options 
           (like --width, --format=png, etc).
           see: https://wkhtmltopdf.org/usage/wkhtmltopdf.txt
   --url
           optionally explicitly identify the url instead of just
           tacking it on the end of the command-line options
   -V, --verbose
           provide verbose logging
   -?, --help
           display this help
```

In addition to these command-line options, options specific to the wkhtmltoimage node package may be passed directly through via the --wkhtmltoimage command-line option.  (see: [https://wkhtmltopdf.org/usage/wkhtmltopdf.txt](https://wkhtmltopdf.org/usage/wkhtmltopdf.txt))

### Trimming and sizing jpg image

wkhtmltopdf/wkhtmltopdf is great at rendering html pages to jpg images and PDF files.  However, since the source is an html page, it makes certain assumptions about the size of the page.  

If the source of the page is something small like a coupon, you may be disappointed that the default rendering produces a 1024px wide image with a lot of padding on the right and probably some on the bottom.

![non-trimmed coupon](https://github.com/danlynn/wkhtmltos3/raw/master/assets/no_trim.jpg "Non-trimmed Coupon")

In order to correct for this common problem, the `--trim` option has been added.  The `--trim` option will use the [`-trim`](http://www.imagemagick.org/Usage/crop/#trim) feature of imagemagick to automagically crop extra whitespace from your rendered jpg image.

![trimmed coupon](https://github.com/danlynn/wkhtmltos3/raw/master/assets/trim.jpg "Trimmed Coupon")

However, if the automatic nature of this feature doesn't work for the types of html pages being rendered then you can explicitly specify `--width=<pixels>` and/or `--height=<pixels>` to set the page size used by wkhtmltoimage/wkhtmltopdf when rendering.

### How to contribute

Check out the project from github at: [https://github.com/danlynn/wkhtmltos3](https://github.com/danlynn/wkhtmltos3)

Make changes to the Dockerfile and build with:

```bash
$ docker build -t danlynn/wkhtmltos3:1.1.0 .
```

...replacing the tag (-t) value as needed.

Launch the image and make interactive changes to the wkhtmltos3.js by mounting the current project directory in the container and opening a bash prompt via:

```bash
$ docker run --rm -it -v $(pwd):/myapp --entrypoint=/bin/bash -e ACCESS_KEY_ID= AKIA000NOTREALKEY000 -e SECRET_ACCESS_KEY= l2r+0000000NotRealSecretAccessKey0000000 danlynn/wkhtmltos3:1.1.0
```

Then from the bash prompt in the container, run the script with your modifications via:

```bash
root@684fc69c5877:/myapp$ node wkhtmltos3.js -V -b my-unique-bucket -k 123/profile12345.jpg -e 1 'http://some.com/retailers/123/users/12345/profile.html'

wkhtmltos3:
  bucket:      my-unique-bucket
  key:         123/profile12345.jpg
  format:      jpg
  expiresDays: 1
  url:         http://some.com/retailers/123/users/12345/profile.html

  rendering...
  uploading 32.57k to s3...
  complete
```
