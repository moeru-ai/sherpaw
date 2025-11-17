FROM debian

SHELL ["/bin/bash", "-c"]

RUN apt update -y
RUN apt install -y curl wget git build-essential cmake python3

RUN mkdir -p /opt
WORKDIR /opt
RUN git clone https://github.com/emscripten-core/emsdk.git --depth 1
WORKDIR /opt/emsdk
RUN git pull
# Hint: Please use a version <= 3.1.64
# Other versions, like 3.1.70, are known not to work
RUN /opt/emsdk/emsdk install 3.1.48

ENV PATH="/opt/emsdk:/opt/emsdk/upstream/emscripten:/opt/emsdk/node/22.16.0_64bit/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
ENV EMSDK="/opt/emsdk"
ENV EMSDK_NODE="/opt/emsdk/node/22.16.0_64bit/bin/node"

WORKDIR /
