package main

import (
	"log"
	"net/http"
)

func main() {
	// Serve files from the current directory
	http.Handle("/", http.FileServer(http.Dir(".")))
	// output server address
	log.Println("serving on http://localhost:8080")
	// Start the server
	log.Fatal(http.ListenAndServe(":8080", nil))
}
