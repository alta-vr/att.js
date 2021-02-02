import { TypedEmitter as EventEmitter } from 'tiny-typed-emitter';

import chalk from 'chalk';
import Logger from '../logger';

const logger = new Logger('LiveList');

interface LiveListEvents<T> 
{
    'create': (item : T) => void;
    'delete': (item : T) => void;
    'update': (item : T, old : T) => void;
}

export class LiveList<T> extends EventEmitter<LiveListEvents<T>> 
{
    name: string;
    items: T[] = [];
    isLive: boolean = false;
    isBlocked: boolean = false;

    private map:{[index:number]:T} = {};

    private getAll: () => Promise<any[]>;
    private subscribeToCreate: (callback: (data: any) => void) => Promise<any>;
    private subscribeToDelete: (callback: (data: any) => void) => Promise<any>;
    private subscribeToUpdate: undefined|((callback: (data: any) => void) => Promise<any>);
    private getRawId: (data: any) => number;
    private getId: (a: T) => number;
    private process: (data: any) => T;
    
    constructor(name: string, getAll: () => Promise<any[]>, subscribeToCreate: (callback: (data: any) => void) => Promise<any>, subscribeToDelete: (callback: (data: any) => void) => Promise<any>, subscribeToUpdate: undefined|((callback: (data: any) => void) => Promise<any>), getRawId: (data: any) => number, getId: (item: T) => number, process: (data: any) => T)
    {
        super();
        this.name = name;
        this.getAll = getAll;
        this.subscribeToCreate = subscribeToCreate;
        this.subscribeToDelete = subscribeToDelete;
        this.getRawId = getRawId;
        this.getId = getId;
        this.process = process;
    }

    get(id:number) : T
    {
       return this.map[id]; 
    }

    async refresh(subscribe: boolean = false): Promise<T[]>
    {
        if (this.isLive || this.isBlocked)
        {
            return this.items;
        }

        if (subscribe)
        {
            this.isLive = true;

            this.subscribeToCreate(this.receiveCreate.bind(this)).then(() => logger.log(`Subscribed to ${this.name} create`)).catch(error =>
            {
                if (error.responseCode == 404)
                    this.block();
            });
            
            this.subscribeToDelete(this.receiveDelete.bind(this)).then(() => logger.log(`Subscribed to ${this.name} delete`)).catch(error =>
            {
                if (error.responseCode == 404)
                    this.block();
            });

            if (!!this.subscribeToUpdate)
            {
                this.subscribeToUpdate(this.receiveUpdate.bind(this)).then(() => logger.log(`Subscribed to ${this.name} update`)).catch(error =>
                {
                    if (error.responseCode == 404)
                        this.block();
                });
            }
        }
        
        try
        {
            var results = await this.getAll();

            if (results === undefined)
            {
                logger.info(`getAll returned undefined in ${this.name}`);

                results = [];
            }
        }
        catch (e)
        {
            logger.error("Error getting items for LiveList");
            logger.info(e);
            
            results = [];
            
            this.block();
        }
        
        for (var i = 0; i < this.items.length; i++)
        {
            var item = this.items[i];
            
            var id = this.getId(item);
        
            if (!results.some((result: any) => this.getRawId(result) == id))
            {
                this.items.splice(i, 1);
                i--;
                delete this.map[id];
                this.emit('delete', item);
            }
        }
        
        for (var result of results)
        {
            this.receiveCreate({ content: result });
        }
        
        return this.items;
    }
    
    private block()
    {
        if (!this.isBlocked)
        {
            this.isBlocked = true;
            logger.error("Not allowed to access " + this.name);
        }
    }
    
    private receiveCreate(event: any)
    {
        if (!event.content)
        {
            logger.info(event);
        }

        try
        {
            var id = this.getRawId(event.content);
        }
        catch (e)
        {
            logger.error("Error in receive create");
            logger.info(e);
            throw e;
        }

        if (!this.items.some(item => this.getId(item) == id))
        {
            var item = this.process(event.content);
            this.items.push(item);
            this.map[id] = item;
            this.emit('create', item);
        }
    }
    
    private receiveDelete(event: any)
    {
        var id = this.getRawId(event.content);
        var index = this.items.findIndex(item => this.getId(item) == id);
    
        if (index >= 0)
        {
            var item = this.items.splice(index, 1)[0];
            delete this.map[id];
            this.emit('delete', item);
        }
    }

    receiveUpdate(event: any)
    {
        var id = this.getRawId(event.content);
        var index = this.items.findIndex(item => this.getId(item) == id);
    
        if (index >= 0)
        {
            var cache = { ...this.items[index] };

            Object.assign(this.items[index], this.process(event.content));

            this.emit('update', this.items[index], cache);
        }
    }
}