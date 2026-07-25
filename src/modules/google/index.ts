import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { Admin, AdminSchema } from '../admin/schemas';
import { AuthModule } from '../auth';
import { GoogleController } from './controller';
import { GoogleService } from './service';

@Module({
  imports: [
    AuthModule,
    JwtModule,
    MongooseModule.forFeature([{ name: Admin.name, schema: AdminSchema }]),
  ],
  controllers: [GoogleController],
  providers: [GoogleService],
})
export class GoogleModule {}
