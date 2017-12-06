#!/usr/bin/env bash

# This shell script is useful for launching a bash shell within
# the wkhtmltos3 docker container.
#
# The ACCESS_KEY_ID and SECRET_ACCESS_KEY env vars will be used
# from your host terminal session if defined.  Otherwise, you will
# need to define them in the container's bash shell or in the
# command-line options passed to the `node src/wkhtmltos3.js`
# invocation.
#
# eg:
#   hostOS$ export ACCESS_KEY_ID=AKIA000NOTREALKEY000
#   hostOS$ export SECRET_ACCESS_KEY=l2r+0000000NotRealSecretAccessKey0000000
#   hostOS$ ./bash
#   docker# node src/wkhtmltos3.js -V -b my-unique-bucket -k 123/profile12345.jpg 'http://some.com/retailers/123/users/12345/profile.html'

docker run --rm -it -v $(pwd):/myapp --entrypoint=/bin/bash -e ACCESS_KEY_ID -e SECRET_ACCESS_KEY danlynn/wkhtmltos3:latest
