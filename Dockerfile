FROM node:4.8.2
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

ENV PATH="/wkhtmltox/bin:${PATH}"

ADD wkhtmltos3.js package.json /myapp/

RUN \
	npm install

# run ember server on container start
ENTRYPOINT ["node", "wkhtmltos3.js"]
