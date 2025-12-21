        const ImageProcessor = {
            /**
             * Processes an image file, resizing it if necessary, and returns a Blob.
             * @param {File|Blob} imageFile - The image file to process.
             * @returns {Promise<Blob>} - The processed image blob.
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
                            }, 'image/jpeg', QUALITY);
                        };
                        img.onerror = (err) => reject(new Error('Failed to load image for processing.'));
                        img.src = e.target.result;
                    };
                    reader.onerror = (err) => reject(new Error('Failed to read image file.'));
                    reader.readAsDataURL(imageFile);
                });
            },

            /**
             * Converts an image blob to a PNG blob.
             * @param {Blob} imageBlob - The source image blob.
             * @returns {Promise<Blob>} - The PNG blob.
             */
            async convertBlobToPNGBlob(imageBlob) {
                return new Promise((resolve, reject) => {
                    const imageUrl = URL.createObjectURL(imageBlob);
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.naturalWidth;
                        canvas.height = img.naturalHeight;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);
                        URL.revokeObjectURL(imageUrl);
                        canvas.toBlob((pngBlob) => {
                            if (pngBlob) {
                                resolve(pngBlob);
                            } else {
                                reject(new Error('Canvas to PNG Blob conversion failed.'));
                            }
                        }, 'image/png');
                    };
                    img.onerror = (err) => {
                        URL.revokeObjectURL(imageUrl);
                        reject(new Error('Failed to load image blob for PNG conversion.'));
                    };
                    img.src = imageUrl;
                });
            }
        };