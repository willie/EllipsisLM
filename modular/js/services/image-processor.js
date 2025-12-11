/**
 * ImageProcessor Module
 * Handles client-side image processing, such as resizing and format conversion.
 */
const ImageProcessor = {
    /**
     * Processes an image file, resizing it if necessary and converting it to a JPEG Blob.
     */
    async processImageAsBlob(imageFile) {
        return new Promise((resolve, reject) => {
            const MAX_HEIGHT = 2000;
            const QUALITY = 0.85;

            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    let { width, height } = img;
                    if (height > MAX_HEIGHT) {
                        const ratio = MAX_HEIGHT / height;
                        height = MAX_HEIGHT;
                        width *= ratio;
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    canvas.toBlob((blob) => {
                        if (blob) {
                            resolve(blob);
                        } else {
                            reject(new Error('Canvas to Blob conversion failed.'));
                        }
                    }, 'image/jpeg', QUALITY); // Still saves as JPEG initially
                };
                img.onerror = (err) => reject(new Error('Failed to load image for processing.'));
                img.src = e.target.result;
            };
            reader.onerror = (err) => reject(new Error('Failed to read image file.'));
            reader.readAsDataURL(imageFile);
        });
    },

    /**
     * Converts an image Blob (potentially JPEG) to a PNG Blob using a canvas.
     * @param {Blob} imageBlob - The input image Blob.
     * @returns {Promise<Blob>} A promise that resolves with the PNG Blob.
     */
    async convertBlobToPNGBlob(imageBlob) {
        return new Promise((resolve, reject) => {
            // Create an object URL from the input Blob
            const imageUrl = URL.createObjectURL(imageBlob);
            const img = new Image();

            img.onload = () => {
                // Image loaded successfully, now draw to canvas
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth; // Use natural dimensions
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);

                // IMPORTANT: Revoke the object URL *after* drawing to canvas
                URL.revokeObjectURL(imageUrl);

                // Convert canvas content to a PNG Blob
                canvas.toBlob((pngBlob) => {
                    if (pngBlob) {
                        resolve(pngBlob); // Resolve the promise with the new PNG Blob
                    } else {
                        reject(new Error('Canvas to PNG Blob conversion failed.'));
                    }
                }, 'image/png'); // Specify PNG format
            };

            img.onerror = (err) => {
                // Handle image loading errors
                URL.revokeObjectURL(imageUrl); // Clean up even on error
                reject(new Error('Failed to load image blob for PNG conversion. Could be invalid image data.'));
            };

            // Start loading the image from the object URL
            img.src = imageUrl;
        });
    }
};
