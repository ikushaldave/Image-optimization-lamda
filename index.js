const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");

const s3Client = new S3Client();

const sizes = [256, 640, 1080, 1920, 2048, 3840];
const supportedExtensions = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".tiff"];

exports.handler = async (event) => {
  console.log("Received event:", JSON.stringify(event, null, 2));

  const { Records } = event;

  for (const record of Records) {
    const sourceBucket = record.s3.bucket.name;
    const sourceKey = decodeURIComponent(
      record.s3.object.key.replace(/\+/g, " ")
    );

    console.log(`Processing: ${sourceBucket}/${sourceKey}`);

    // Check if the file has a supported image extension
    const fileExtension = sourceKey.split(".").pop().toLowerCase();
    if (!supportedExtensions.includes(`.${fileExtension}`)) {
      console.log(`Unsupported file type: ${fileExtension}. Skipping.`);
      continue;
    }

    try {
      const getObjectParams = {
        Bucket: sourceBucket,
        Key: sourceKey,
      };
      console.log("GetObject params:", JSON.stringify(getObjectParams));

      const { Body } = await s3Client.send(
        new GetObjectCommand(getObjectParams)
      );

      const imageBody = await streamToBuffer(Body);

      const sharp = require("sharp");

      const baseImage = sharp(imageBody);
      const metadata = await baseImage.metadata();

      console.log(`Image metadata:`, metadata);

      // Process original size (convert to WebP without resizing)
      const originalWebP = await baseImage
        .clone()
        .webp({
          quality: 100,
          lossless: false,
          effort: 6,
        })
        .toBuffer();

      const originalKey = `${sourceKey.split(".")[0]}-original.webp`;
      await s3Client.send(
        new PutObjectCommand({
          Bucket: sourceBucket,
          Key: originalKey,
          Body: originalWebP,
          ContentType: "image/webp",
        })
      );
      console.log(`Processed and uploaded original: ${originalKey}`);

      // Process resized versions
      for (const width of sizes.filter((size) => size <= metadata.width)) {
        const resizedImage = await baseImage
          .clone()
          .resize({
            width,
            withoutEnlargement: true,
            kernel: sharp.kernel.lanczos3,
          })
          .webp({
            quality: 100,
            lossless: false,
            effort: 6,
          })
          .toBuffer();

        const destinationKey = `${sourceKey.split(".")[0]}-${width}.webp`;

        const putObjectParams = {
          Bucket: sourceBucket,
          Key: destinationKey,
          Body: resizedImage,
          ContentType: "image/webp",
        };
        console.log("PutObject params:", JSON.stringify(putObjectParams));

        await s3Client.send(new PutObjectCommand(putObjectParams));

        console.log(`Processed and uploaded: ${destinationKey}`);
      }
    } catch (error) {
      console.error(`Error processing ${sourceKey}:`, error);
      console.error("Error stack:", error.stack);
    }
  }

  return { statusCode: 200, body: "Image processing complete" };
};

// Helper function to convert stream to buffer
async function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}
