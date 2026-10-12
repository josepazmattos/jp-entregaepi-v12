//go:build !windows

package main

import "fmt"

func installer(uninstall bool) {
	fmt.Println("Este piloto de instalação é destinado ao Windows x64.")
}
