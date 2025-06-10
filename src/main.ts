import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    const allowedOrigins = ['http://localhost:5173', 'https://admin-page-nutri-day.vercel.app/'];

    app.enableCors({
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true);
            } else {
                callback(new Error('Not allowed by CORS'));
            }
        },
        credentials: true,
    });
    // app.enableCors({
    //     origin: 'http://localhost:5173',
    //     credentials: true,
    // });
    await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
