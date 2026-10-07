//go:build !windows

package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
)

func requireWindows() error                        { return errors.New("este reparador é destinado ao Windows") }
func configureHidden(cmd *exec.Cmd)                {}
func notifyUser(message string, failed bool)       { fmt.Fprintln(os.Stderr, message) }
func replaceFile(source, destination string) error { return os.Rename(source, destination) }
func launcherMutex(dir string) (func(), error)     { return nil, requireWindows() }
func protectInstallDirectory(dir string) error     { return requireWindows() }
func registerLauncher(executable string) error     { return requireWindows() }
func registryJavaCandidates() []string             { return nil }
