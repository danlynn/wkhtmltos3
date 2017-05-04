FROM node:6.10.2
MAINTAINER Dan Lynn <docker@danlynn.org>

WORKDIR /myapp

# install dependencies
RUN \
	apt-get update -y && \
	DEBIAN_FRONTEND=noninteractive apt-get -y install build-essential xorg libssl-dev libxrender-dev wget

# install wkhtmltopdf
RUN \
	wget https://downloads.wkhtmltopdf.org/0.12/0.12.4/wkhtmltox-0.12.4_linux-generic-amd64.tar.xz && \
    tar xf wkhtmltox-0.12.4_linux-generic-amd64.tar.xz -C / && \
    rm wkhtmltox-0.12.4_linux-generic-amd64.tar.xz

# install imagemagick in order to support the --trim command line option
# to trim whitespace caused by wkhtmltoimage assuming full width unless
# --width option provided
RUN apt-get install -y imagemagick=8:6.8.9.9-5+deb8u8 --no-install-recommends && \
	rm -rf /var/lib/apt/lists/*

ENV PATH="/wkhtmltox/bin:${PATH}"

ADD wkhtmltos3.js package.json /myapp/

RUN \
	npm install

# run wkhtmltos3.js script using node on container start
ENTRYPOINT ["node", "wkhtmltos3.js"]
