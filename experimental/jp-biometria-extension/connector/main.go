package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"os"
	"regexp"
)

const maxRequest = 4096
const maxResponse = 512 * 1024

type Request struct {
	Action string `json:"action"`
	Finger string `json:"finger,omitempty"`
}

// Explicit response contract: no templates, keys, certificates or raw agent data.
type Response struct {
	OK               bool   `json:"ok"`
	Code             string `json:"code"`
	ConnectorVersion string `json:"connectorVersion"`
	AgentVersion     string `json:"agentVersion,omitempty"`
	Port             int    `json:"port,omitempty"`
	Image            string `json:"image,omitempty"`
	Width            int    `json:"width,omitempty"`
	Height           int    `json:"height,omitempty"`
}

func result(code string) Response {
	return Response{OK: code == "READY" || code == "CAPTURE_OK", Code: code, ConnectorVersion: connectorVersion}
}

func validRequest(r Request) bool {
	return r.Action == "status" && r.Finger == "" || r.Action == "captureTest" && validFinger(r.Finger)
}

func validFinger(f string) bool {
	switch f {
	case "R_THUMB", "R_INDEX", "R_MIDDLE", "R_RING", "R_LITTLE", "L_THUMB", "L_INDEX", "L_MIDDLE", "L_RING", "L_LITTLE":
		return true
	}
	return false
}

func serve(in io.Reader, out io.Writer, handle func(Request) Response) error {
	for {
		var size uint32
		if err := binary.Read(in, binary.LittleEndian, &size); err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return err
		}
		if size == 0 || size > maxRequest {
			return errors.New("invalid frame size")
		}
		buf := make([]byte, size)
		if _, err := io.ReadFull(in, buf); err != nil {
			return err
		}
		var request Request
		dec := json.NewDecoder(bytes.NewReader(buf))
		dec.DisallowUnknownFields()
		response := result("INVALID_REQUEST")
		if dec.Decode(&request) == nil && dec.Decode(new(any)) == io.EOF && validRequest(request) {
			response = handle(request)
		}
		data, err := json.Marshal(response)
		if err != nil || len(data) > maxResponse {
			return errors.New("response too large")
		}
		if err := binary.Write(out, binary.LittleEndian, uint32(len(data))); err != nil {
			return err
		}
		if _, err := out.Write(data); err != nil {
			return err
		}
	}
}

var parentWindow = regexp.MustCompile(`^--parent-window=[0-9]+$`)

func validCaller(args []string) bool {
	return (len(args) == 1 || len(args) == 2 && parentWindow.MatchString(args[1])) && args[0] == "chrome-extension://"+extensionID+"/"
}

func main() {
	args := os.Args[1:]
	if len(args) == 0 {
		installer(false)
		return
	}
	if len(args) == 1 && args[0] == "--uninstall" {
		installer(true)
		return
	}
	if !validCaller(args) {
		os.Exit(2)
	}
	// A fresh native process per request; capture is never retried automatically.
	if serve(os.Stdin, os.Stdout, handle) != nil {
		os.Exit(1)
	}
}
